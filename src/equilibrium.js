export const equilibriumDefaults={material:'Si',temperatureK:300,acceptorCm3:1e16,donorCm3:1e16,pLengthUm:2,intrinsicLengthUm:0,nLengthUm:2,meshNm:10};
export function validateEquilibrium(c) {
  if(!c||c.material!=='Si'||c.temperatureK!==300)throw Error('平衡求解仅支持 300 K 体硅同质 PN/PIN 模型。');
  const ranges={acceptorCm3:[1e14,1e18],donorCm3:[1e14,1e18],pLengthUm:[.1,20],nLengthUm:[.1,20],intrinsicLengthUm:[0,20],meshNm:[2,100]};
  for(const [key,[min,max]]of Object.entries(ranges))if(typeof c[key]!=='number'||!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw Error(`${key} 应在 ${min}–${max} 内。`);
  if(c.intrinsicLengthUm>0&&c.intrinsicLengthUm*1000<4*c.meshNm)throw Error('i 区至少需要四个网格间距，请减小网格间距。');
  if((c.pLengthUm+c.nLengthUm+c.intrinsicLengthUm)*1000/c.meshNm>6000)throw Error('物理网格过大，请增大网格间距或缩短区域。');
  return c;
}
