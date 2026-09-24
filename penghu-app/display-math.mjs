// Display metres only; routing and risk never consume these values.
export function droneSpan(distance,nativeSpan,tail=false){
 if(tail||distance<=500)return nativeSpan;
 const t=Math.min(1,(distance-500)/1000),blend=t*t*(3-2*t);
 return Math.min(160,nativeSpan+(Math.max(nativeSpan,distance*0.02)-nativeSpan)*blend);
}
export function labelWorldHeight(depth,fov,viewportHeight,pixels=18){return 2*Math.max(0,depth)*Math.tan(fov*Math.PI/360)*pixels/viewportHeight;}
