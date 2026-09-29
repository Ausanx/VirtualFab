import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { escapeHtml as esc } from './viewer.js';

const colors={Si:0x2f7fae,Mo:0x4f565d,S:0xe5a15a};
export class AtomicViewer{
  constructor(container){
    this.container=container;this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xf3f5f7);
    this.camera=new THREE.PerspectiveCamera(35,1,0.01,4000);
    this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    container.append(this.renderer.domElement);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.addEventListener('change',()=>this.draw());
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x6e7783,2.3));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(8,-5,15);this.scene.add(light);
    this.group=new THREE.Group();this.scene.add(this.group);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
  }
  resize(){const {clientWidth:w,clientHeight:h}=this.container;if(w<2||h<2)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.draw();}
  draw(){this.renderer.render(this.scene,this.camera);}
  update(s){
    while(this.group.children.length){const child=this.group.children.at(-1);child.geometry?.dispose();child.material?.dispose();this.group.remove(child);}
    const vectors=s.cellAngstrom.map(v=>new THREE.Vector3(...v)),points=[],edges=[];
    for(let i=0;i<8;i++){const p=new THREE.Vector3();vectors.forEach((v,k)=>{if(i&(1<<k))p.add(v);});points.push(p);}
    for(let i=0;i<8;i++)for(let k=0;k<3;k++)if(!(i&(1<<k)))edges.push(points[i],points[i|(1<<k)]);
    const cell=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(edges),new THREE.LineBasicMaterial({color:0x8b99a5}));this.group.add(cell);
    s.positionsAngstrom.forEach((p,i)=>{const mesh=new THREE.Mesh(new THREE.SphereGeometry(s.symbols[i]==='Mo'?0.52:0.42,24,18),new THREE.MeshStandardMaterial({color:colors[s.symbols[i]],roughness:.58}));mesh.position.set(...p);this.group.add(mesh);});
    const box=new THREE.Box3().setFromPoints([...points,...s.positionsAngstrom.map(p=>new THREE.Vector3(...p))]);
    this.center=box.getCenter(new THREE.Vector3());this.radius=box.getSize(new THREE.Vector3()).length()/2;
    this.fit();
  }
  fit(){if(!this.center)return;const distance=Math.max(3,this.radius)*2.9;this.camera.position.copy(this.center).add(new THREE.Vector3(distance*.7,-distance*.9,distance*.65));this.camera.up.set(0,0,1);this.camera.near=.01;this.camera.far=Math.max(200,distance*10);this.camera.updateProjectionMatrix();this.controls.target.copy(this.center);this.controls.update();this.resize();}
}
export function drawAtomicBands(container,bands,occupied){
  if(!bands){container.innerHTML='';return;}
  const width=660,height=310,left=58,right=20,top=18,bottom=43,xmax=Math.max(...bands.x),xmin=Math.min(...bands.x);
  const x=v=>left+(v-xmin)/(xmax-xmin||1)*(width-left-right),y=v=>height-bottom-(v+6)/12*(height-top-bottom);
  const tickGroups=[];
  bands.ticks.forEach((value,i)=>{
    const label=bands.labels[i]==='G'?'Γ':bands.labels[i],previous=tickGroups.at(-1);
    if(previous&&Math.abs(previous.value-value)<1e-10)previous.label+='|'+label;
    else tickGroups.push({value,label});
  });
  const ticks=tickGroups.map(({value,label})=>`<line x1="${x(value)}" x2="${x(value)}" y1="${top}" y2="${height-bottom}" stroke="#d9dee3"/><text x="${x(value)}" y="${height-bottom+19}" text-anchor="middle" class="plot-text">${esc(label)}</text>`).join('');
  const yticks=[-6,-4,-2,0,2,4,6].map(v=>`<line x1="${left}" x2="${left+5}" y1="${y(v)}" y2="${y(v)}" stroke="#4f565d"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end" class="plot-text">${v}</text>`).join('');
  const paths=Array.from({length:bands.energiesEv[0].length},(_,j)=>{
    const points=bands.energiesEv.map((energies,i)=>`${i===0||bands.x[i]===bands.x[i-1]?'M':'L'}${x(bands.x[i]).toFixed(2)},${y(energies[j]-bands.referenceEv).toFixed(2)}`).join(' ');
    return `<path data-band="${j+1}" d="${points}" fill="none" stroke="${j<occupied?'#2f7fae':'#e5a15a'}" stroke-width="1.4"/>`;
  }).join('');
  container.innerHTML=`<div class="analysis-title"><h2>晶体能带 E(k)</h2><span>采样 VBM = 0 · eV</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="DFT 晶体能带"><defs><clipPath id="atomic-band-clip"><rect x="${left}" y="${top}" width="${width-left-right}" height="${height-top-bottom}"/></clipPath></defs>${ticks}${yticks}<g clip-path="url(#atomic-band-clip)">${paths}<line x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}" stroke="#8b99a5" stroke-dasharray="4 3"/></g><rect x="${left}" y="${top}" width="${width-left-right}" height="${height-top-bottom}" fill="none" stroke="#4f565d" stroke-width="1.67"/><text transform="translate(16,${height/2}) rotate(-90)" class="plot-text" text-anchor="middle">E − VBM (eV)</text><text x="${(left+width-right)/2}" y="${height-4}" text-anchor="middle" class="plot-text">k 路径</text></svg>`;
}
