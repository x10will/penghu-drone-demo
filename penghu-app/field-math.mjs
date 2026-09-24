export const HATCH_MARGIN = 0.28;
export const FIELD_CEILING_M = 120;
export function cellStyle(danger, margin, land, dangerClamp, safetyLimit) {
  const blocked = !land && danger + margin > safetyLimit;
  if (land || danger >= dangerClamp) return {rgba:[190,211,226,0.18],hatch:false,blocked};
  const d = Math.min(danger,1.2);
  let rgb;
  if (d < 0.5) {const t=d/0.5;rgb=[Math.round(46+207*t),Math.round(204-t),Math.round(113-3*t)];}
  else if (d < 1) {const t=(d-0.5)/0.5;rgb=[Math.round(253-39*t),Math.round(203-155*t),Math.round(110-61*t)];}
  else rgb=[125,17,40];
  return {rgba:[...rgb,Number((0.1+0.6*Math.pow(Math.min(d,1),1.5)).toFixed(3))],hatch:margin>HATCH_MARGIN,blocked};
}

export function sampledGrid(bbox, geoToLocal, sampleGround, spacing=250) {
  const [west,south,east,north]=bbox;
  const [x0,y0]=geoToLocal(south,west), [x1,y1]=geoToLocal(north,east);
  const nx=Math.ceil((x1-x0)/spacing),ny=Math.ceil((y1-y0)/spacing);
  const positions=new Float32Array((nx+1)*(ny+1)*3),uv=new Float32Array((nx+1)*(ny+1)*2);
  const indices=new Uint32Array(nx*ny*6);
  const report={vertices:(nx+1)*(ny+1),triangles:nx*ny*2,spacingX:(x1-x0)/nx,spacingY:(y1-y0)/ny,finite:0,missing:0,minZ:Infinity,maxZ:-Infinity};
  for(let r=0;r<=ny;r++)for(let c=0;c<=nx;c++){
    const i=r*(nx+1)+c,x=x0+(x1-x0)*c/nx,y=y0+(y1-y0)*r/ny,z=sampleGround(x,y);
    positions.set([x,y,Number.isFinite(z)?FIELD_CEILING_M:NaN],i*3);uv.set([c/nx,r/ny],i*2);
    if(Number.isFinite(z)){report.finite++;report.minZ=Math.min(report.minZ,z);report.maxZ=Math.max(report.maxZ,z);}else report.missing++;
    if(r<ny&&c<nx){const k=(r*nx+c)*6;indices.set([i,i+1,i+nx+1,i+1,i+nx+2,i+nx+1],k);}
  }
  return {positions,uv,indices,report};
}
