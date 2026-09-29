import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { evidenceNames,getMaterial } from './materials.js';
import { cellPosition } from './engine.js';

export const escapeHtml = x => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = x => Math.abs(x)<1e-7?'0':Number(x.toFixed(2)).toString();
export class StructureViewer {
  constructor(container) {
    this.container=container;this.scene=new THREE.Scene();this.scene.background=new THREE.Color(getComputedStyle(container).getPropertyValue('--inset').trim());
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    container.replaceChildren(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(38,1,.1,2000);this.camera.position.set(57,49,64);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.target.set(0,1,0);this.controls.addEventListener('change',()=>this.render());
    this.scene.add(new THREE.AmbientLight('#d2e2ec',2));
    const light=new THREE.DirectionalLight('#ffffff',3);light.position.set(-30,80,30);this.scene.add(light);
    const fill=new THREE.DirectionalLight('#75bfc7',1.5);fill.position.set(30,10,-40);this.scene.add(fill);
    this.group=new THREE.Group();this.scene.add(this.group);this.slice=null;this.state=null;this.exploded=false;this.wafer=false;
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(w<1||h<1)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);this.render();}
  render(){this.renderer.render(this.scene,this.camera);}
  clear(){this.group.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});this.group.clear();}
  update(state,materials,sliceIndex) {
    const previousSize=this.state?.sizeUm;
    this.state=state;this.materials=materials;this.sliceIndex=sliceIndex;this.clear();
    const maxZ=Math.max(1,...state.cells.map(c=>c.at(-1)?.z1||0));
    this.gain=Math.min(80,8000/maxZ);const sz=this.gain/1000;
    const oxide=state.substrate?.oxideNm||0,oxideDisplay=oxide?1.5:0,supportDisplay=2.5;
    const minZ=-oxide-1;
    const displayZ=z=>z>=0?z*sz:z>=-oxide?z/oxide*oxideDisplay:-oxideDisplay-supportDisplay;
    this.minZ=minZ;
    const dx=state.sizeUm/state.resolution;
    if(this.wafer&&state.substrate) {
      const wafer=new THREE.Mesh(new THREE.CylinderGeometry(20,20,.8,96),new THREE.MeshStandardMaterial({color:state.substrate.oxideNm?'#b5c5cf':'#758694',metalness:.2,roughness:.55}));
      this.group.add(wafer);
      if(state.substrate.die){const ratio=40/(state.substrate.waferInch*25.4),die=state.substrate.die;const mesh=new THREE.Mesh(new THREE.BoxGeometry(die.widthMm*ratio,.25,die.lengthMm*ratio),new THREE.MeshStandardMaterial({color:'#55bfc4',transparent:true,opacity:.65}));mesh.position.y=.53;this.group.add(mesh);}
      this.slice=null;
    } else {
      const boxes=new Map(),stepOrder=[...new Set(state.cells.flat().filter(l=>l.role!=='support').map(l=>l.stepId))];
      // Merge adjacent equal columns along X for fewer draw instances, without modifying model geometry.
      for(let y=0;y<state.resolution;y++) {
        const runs=new Map();
        for(let x=0;x<state.resolution;x++)for(const layer of state.cells[y*state.resolution+x]) {
          const z0=Math.max(layer.z0,minZ),z1=layer.z1;if(z1<=z0)continue;
          const key=[layer.material,layer.stepId,layer.role,z0,z1,layer.exposed].join(':');
          if(!runs.has(key))runs.set(key,[]);
          const rs=runs.get(key),last=rs.at(-1);if(last&&last.end===x)last.end=x+1;else rs.push({start:x,end:x+1,layer,z0,z1});
        }
        for(const rs of runs.values())for(const r of rs){const material=r.layer.material;if(!boxes.has(material))boxes.set(material,[]);boxes.get(material).push({...r,y});}
      }
      const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion();
      for(const [id,list]of boxes) {
        const material=getMaterial(materials,id),metal=['conductor','tco','semimetal'].includes(material.category);
        const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:material.color,metalness:metal?.35:.03,roughness:metal?.48:.72}),list.length);
        list.forEach((r,i)=>{
          const exploded=this.exploded?Math.max(0,stepOrder.indexOf(r.layer.stepId))*1.4:0;
          matrix.compose(new THREE.Vector3(((r.start+r.end)/2)*dx-state.sizeUm/2,(displayZ(r.z0)+displayZ(r.z1))/2+exploded,(r.y+.5)*dx-state.sizeUm/2),quaternion,new THREE.Vector3((r.end-r.start)*dx,Math.max(.005,displayZ(r.z1)-displayZ(r.z0)),dx));mesh.setMatrixAt(i,matrix);
          if(r.layer.exposed!==undefined)mesh.setColorAt(i,new THREE.Color(r.layer.exposed?'#d5a69c':material.color));
        });mesh.instanceMatrix.needsUpdate=true;this.group.add(mesh);
      }
      const grid=new THREE.GridHelper(state.sizeUm*1.5,12,'#9bafbf','#d2dee7');grid.position.y=displayZ(minZ)-.3;this.group.add(grid);
      const height=displayZ(maxZ)-displayZ(minZ)+2;
      this.slice=new THREE.Mesh(new THREE.PlaneGeometry(state.sizeUm,height),new THREE.MeshBasicMaterial({color:'#55bfc4',transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false}));
      this.slice.position.set(0,(displayZ(maxZ)+displayZ(minZ))/2,(sliceIndex+.5)*dx-state.sizeUm/2);this.group.add(this.slice);
      const lineGeo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-state.sizeUm/2,displayZ(maxZ)+.6,this.slice.position.z),new THREE.Vector3(state.sizeUm/2,displayZ(maxZ)+.6,this.slice.position.z)]);
      this.group.add(new THREE.Line(lineGeo,new THREE.LineBasicMaterial({color:'#0b747b'})));
    }
    this.frameY=(displayZ(maxZ)+displayZ(minZ))*.5;
    if(!this.framed||previousSize!==state.sizeUm){this.framed=true;this.setView('perspective');}
    else this.render();
    return {gain:this.gain,minZ,maxZ};
  }
  setView(type) {
    const size=this.wafer?40:(this.state?.sizeUm||40),d=size*1.62,targetY=this.wafer?0:(this.frameY||0);
    this.camera.far=Math.max(2000,d*3);this.camera.updateProjectionMatrix();
    if(type==='top')this.camera.position.set(0,targetY+d*1.25,.01);
    else if(type==='front')this.camera.position.set(0,targetY+d*.1,d*1.35);
    else this.camera.position.set(d*.9,targetY+d*.8,d);
    this.controls.target.set(0,targetY,0);this.controls.update();this.render();
  }
}

function axes(x,y,w,h,xTicks,yTicks,xLabel,yLabel) {
  let svg=`<rect class="plot-axis" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  for(const t of xTicks)svg+=`<path class="plot-tick" d="M${t.pos} ${y+h}v-5"/><text class="plot-text" x="${t.pos}" y="${y+h+16}" text-anchor="middle">${escapeHtml(t.label)}</text>`;
  for(const t of yTicks)svg+=`<path class="plot-tick" d="M${x} ${t.pos}h5"/><text class="plot-text" x="${x-8}" y="${t.pos+3}" text-anchor="end">${escapeHtml(t.label)}</text>`;
  for(let i=1;i<20;i++)if(i%5)svg+=`<path class="plot-tick" d="M${x+i*w/20} ${y+h}v-2.5 M${x} ${y+i*h/20}h2.5"/>`;
  return svg+`<text class="plot-text" x="${x+w}" y="${y+h+32}" text-anchor="end">${xLabel}</text><text class="plot-text" x="${x}" y="${y-8}">${yLabel}</text>`;
}
export function drawSlice(container,state,materials,index) {
  const W=container.clientWidth?Math.max(320,container.clientWidth-16):740,H=container.clientHeight||174,x=63,y=24,w=W-83,h=H-62,n=state.resolution;
  const cells=state.cells.slice(index*n,(index+1)*n),max=Math.max(1,...cells.map(c=>c.at(-1)?.z1||0));
  const min=-(state.substrate?.oxideNm||0)-Math.max(30,max*.03),top=max*1.07;
  const py=z=>y+h-(z-min)/(top-min)*h;
  let content='';
  cells.forEach((c,i)=>c.forEach(l=>{const z0=Math.max(min,l.z0),z1=l.z1;if(z1>z0)content+=`<rect x="${x+i*w/n}" y="${py(z1)}" width="${w/n+.1}" height="${Math.max(.35,py(z0)-py(z1))}" fill="${getMaterial(materials,l.material).color}"><title>${escapeHtml(l.material)} · ${number(l.z1-l.z0)} nm</title></rect>`;}));
  const xt=Array.from({length:5},(_,i)=>({pos:x+w*i/4,label:number((i/4-.5)*state.sizeUm)}));
  const yt=[min,0,max].filter((z,i,a)=>a.findIndex(v=>Math.abs(v-z)<1e-6)===i).map(z=>({pos:py(z),label:number(z)}));
  const total=Math.max(...state.cells.map(c=>c.at(-1)?.z1||0));
  container.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Y 截面材料结构"><title>局部剖面，横纵比例不同，硅片底部截断</title>${content}${axes(x,y,w,h,xt,yt,'x (μm)','z (nm)')}<text class="plot-text" x="${x+w}" y="14" text-anchor="end">截断衬底 · 总表面高度 ${number(total)} nm</text></svg>`;
}
export function drawBands(container,state,materials) {
  const ids=[...new Set(state.cells.flat().filter(l=>l.role!=='resist'&&l.role!=='support').map(l=>l.material))];
  if(!ids.length){container.innerHTML='<p class="empty-message">加入功能材料后显示带边。尚无材料时不生成能带。</p>';return;}
  const x=54,y=30,h=168,w=Math.max(570,ids.length*112),W=w+80,H=248,py=e=>y-e/11*h;
  let content='',xt=[];
  ids.forEach((id,i)=>{
    const m=getMaterial(materials,id),cx=x+(i+.5)*w/ids.length,bw=Math.min(78,w/ids.length-18);xt.push({pos:cx,label:id});
    if(m.category==='semiconductor'&&m.affinity.value!==null&&m.bandGap.value!==null){
      const ec=-m.affinity.value,ev=ec-m.bandGap.value;
      const evidence=m.bandGap.evidence==='estimated'||m.affinity.evidence==='estimated'?'含估算参数':m.bandGap.evidence==='derived'||m.affinity.evidence==='derived'?'含推导参数':'实测参数';
      content+=`<rect x="${cx-bw/2}" y="${py(ec)}" width="${bw}" height="${py(ev)-py(ec)}" fill="${m.color}" opacity=".12"/><path d="M${cx-bw/2} ${py(ec)}h${bw} M${cx-bw/2} ${py(ev)}h${bw}" stroke="${m.color}" stroke-width="2"/><text class="plot-text" x="${cx}" y="${py(ec)-6}" text-anchor="middle">E꜀ ${number(ec)}</text><text class="plot-text" x="${cx}" y="${py(ev)+13}" text-anchor="middle">Eᵥ ${number(ev)}</text><text class="plot-text" x="${cx}" y="${py(ev)+27}" text-anchor="middle">${evidence}</text>`;
    } else if(['conductor','tco','semimetal'].includes(m.category)&&m.workFunction.value!==null){
      const ef=-m.workFunction.value;content+=`<path d="M${cx-bw/2} ${py(ef)}h${bw}" stroke="${m.color}" stroke-width="2" stroke-dasharray="5 3"/><text class="plot-text" x="${cx}" y="${py(ef)-8}" text-anchor="middle">Eꜰ ${number(ef)}</text><text class="plot-text" x="${cx}" y="${py(ef)+16}" text-anchor="middle">功函数 ${evidenceNames[m.workFunction.evidence]}</text>`;
    } else content+=`<rect x="${cx-bw/2}" y="${y+45}" width="${bw}" height="85" fill="none" stroke="#718291" stroke-dasharray="3 5"/><text class="plot-text" x="${cx}" y="${y+88}" text-anchor="middle">带边缺失</text>`;
  });
  const yt=[0,-2,-4,-6,-8,-10].map(e=>({pos:py(e),label:e}));
  container.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="min-width:${W}px" role="img" aria-label="材料真空参考能带"><title>材料带边对齐近似，非接触后的自洽能带</title>${content}${axes(x,y,w,h,xt,yt,'','E (eV)')}</svg>`;
}
export function drawCurve(container,rows) {
  const W=Math.max(360,container.clientWidth||735),x=70,y=25,w=W-95,h=150,min=Math.min(...rows.map(r=>r.currentA)),max=Math.max(...rows.map(r=>r.currentA)),span=max-min||1;
  const px=v=>x+(v-rows[0].voltageV)/(rows.at(-1).voltageV-rows[0].voltageV)*w,py=i=>y+h-(i-min)/span*h;
  const d=rows.map((r,i)=>`${i?'L':'M'}${px(r.voltageV).toFixed(2)} ${py(r.currentA).toFixed(2)}`).join(' ');
  const xt=Array.from({length:5},(_,i)=>({pos:x+i*w/4,label:number(rows[0].voltageV+(rows.at(-1).voltageV-rows[0].voltageV)*i/4)}));
  const yt=Array.from({length:5},(_,i)=>({pos:y+h-i*h/4,label:(min+span*i/4).toExponential(1)}));
  container.innerHTML=`<svg viewBox="0 0 ${W} 225" role="img" aria-label="手动参数 Shockley 二极管曲线">${axes(x,y,w,h,xt,yt,'V (V)','I (A)')}<path d="${d}" stroke="#2F7FAE" stroke-width="2" fill="none"/><text class="plot-text" x="${x+w}" y="16" text-anchor="end">条件模型 · 非器件标定预测</text></svg>`;
}
