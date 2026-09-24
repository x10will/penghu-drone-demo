import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {poseAt,riskAt,displayPath} from './timeline.mjs';
import {droneSpan,labelWorldHeight} from './display-math.mjs';

export class RouteActor {
 constructor(api,route,requestId){this.api=api;this.route=route;this.requestId=requestId;this.root=new api.THREE.Group();this.root.name='penghu-route';this.off=[];this.disposed=false;}
 async load(){
  const {THREE}=this.api;
  const response=await fetch(new URL('../data/penghu_graph.json',import.meta.url));
  if(!response.ok)throw new Error('Unable to load pad positions');
  const graph=await response.json(),routes=this.route.routes||[this.route];
  const displayRoutes=routes.map(route=>{const origin=graph.nodes.find(n=>n.id===route.from_id),destination=graph.nodes.find(n=>n.id===route.to_id);
   if(!origin||!destination)throw new Error('Route endpoint pad is missing');
   return {...route,path:displayPath(route,origin,destination)};});
  // Display-only endpoint alignment; never mutate the engine response or ledger inputs.
  this.displayRoute=this.route.routes?{...this.route,routes:displayRoutes}:displayRoutes[0];
  this.framePoints=[...displayRoutes.flatMap(r=>r.path.map(p=>{const [x,y]=this.api.geoToLocal(p.lat,p.lng);return new THREE.Vector3(x,y,100);})),...graph.nodes.map(n=>{const [x,y]=this.api.geoToLocal(n.lat,n.lng);return new THREE.Vector3(x,y,this.api.sampleGround(x,y));})];
  const gltf=await new GLTFLoader().loadAsync(new URL('../data/models/CesiumDrone.glb',import.meta.url).href);
  this.model=gltf.scene;this.model.rotation.x=Math.PI/2;
  this.model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(this.model);const size=box.getSize(new THREE.Vector3());
  this.nativeSpan=Math.max(size.x,size.y);this.modelBottom=box.min.z;
  this.drone=new THREE.Group();this.drone.name='penghu-drone';this.drone.add(this.model);this.root.add(this.drone);
  this.mixer=new THREE.AnimationMixer(this.model);for(const clip of gltf.animations)this.mixer.clipAction(clip).play();
  displayRoutes.forEach((route,index)=>{
   const points=route.path.map(p=>{const [x,y]=this.api.geoToLocal(p.lat,p.lng);return new THREE.Vector3(x,y,100);});
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:index?0xffc36b:0x00fff0,depthTest:false,transparent:true,opacity:0.95}));line.name=index?'penghu-return-path':'penghu-outbound-path';this.root.add(line);
   const pad=route.path[0];this.badge(index?`折返地面待命 ${Math.round(this.route.turnaround_min)} 分`:`延後 ${route.delay_min} 分 · 地面待命`,pad.lat,pad.lng,index?'turnaround':'origin-delay');
   for(const [i,w]of route.waits.entries()){const p=poseAt(route,w.t0_h);this.badge(`${w.name} 停等 ${w.minutes} 分`,p.lat,p.lng,`wait-${index}-${i}`);}
  });
  this.label=this.makeLabel('無人機 · 顯示比例放大');this.drone.add(this.label);this.label.position.z=180;
  this.off.push(this.api.registerPickable(this.drone,{id:'twin-drone',label:'排程四旋翼',type:'drone'}));
  this.root.traverse(object=>{object.renderOrder=20;});
  if(this.disposed){this.release();return;}
  this.api.scene.add(this.root);
 }
 frameRoute(width,height){
  const {THREE,camera}=this.api,center=new THREE.Box3().setFromPoints(this.framePoints).getCenter(new THREE.Vector3());
  const points=this.framePoints.map(p=>p.clone().sub(center)),ty=Math.tan(camera.fov*Math.PI/360)/camera.zoom,tx=ty*width/height;
  const insetX=Math.max(0.2,1-80/width),insetY=Math.max(0.2,1-112/height);let best;
  // Fit a shallow top-down view, checking every point against the perspective
  // frustum. Reserve 56 px vertically for the bottom legend plus a small margin.
  for(let angle=0;angle<Math.PI;angle+=Math.PI/36){
   const right=new THREE.Vector3(Math.cos(angle),Math.sin(angle),0),eye=new THREE.Vector3(Math.sin(angle)*Math.sin(Math.PI/18),-Math.cos(angle)*Math.sin(Math.PI/18),Math.cos(Math.PI/18)),up=eye.clone().cross(right);
   const q=points.map(p=>({x:p.dot(right),y:p.dot(up),z:p.dot(eye)}));
   const distance=Math.max(10,...q.map(p=>p.z+Math.max(Math.abs(p.x)/(tx*insetX),Math.abs(p.y)/(ty*insetY))));
   const xs=q.map(p=>p.x/((distance-p.z)*tx)),ys=q.map(p=>p.y/((distance-p.z)*ty));
   const score=(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys));
   if(!best||score>best.score)best={score,position:center.clone().addScaledVector(eye,distance)};
  }
  return this.api.setCameraPose(best.position.toArray(),center.toArray());
 }
 makeLabel(text){
  const {THREE}=this.api,canvas=document.createElement('canvas');canvas.width=640;canvas.height=80;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#092835ed';ctx.fillRect(0,0,640,80);ctx.strokeStyle='#58dfd0';ctx.strokeRect(1,1,638,78);ctx.fillStyle='white';ctx.font='30px sans-serif';ctx.textAlign='center';ctx.fillText(text,320,51);
  const map=new THREE.CanvasTexture(canvas),sprite=new THREE.Sprite(new THREE.SpriteMaterial({map,depthTest:false,transparent:true}));sprite.scale.set(1000,125,1);return sprite;
 }
 badge(text,lat,lng,id){const [x,y]=this.api.geoToLocal(lat,lng),z=this.api.sampleGround(x,y);if(!Number.isFinite(z))throw new Error('Missing pad ground height');
  const label=this.makeLabel(text);label.name=`twin-wait-badge-${id}`;label.position.set(x,y,z+220);this.root.add(label);this.off.push(this.api.registerPickable(label,{id:`twin-${id}`,label:text,type:'wait',properties:{lat,lon:lng}}));}
 sync(hour,delta=0,tail=false){
  if(this.disposed||!this.drone)return null;
  const p=poseAt(this.displayRoute,hour),[x,y]=this.api.geoToLocal(p.lat,p.lng),z=p.ground?this.api.sampleGround(x,y):100;
  if(!Number.isFinite(z))throw new Error('Missing drone ground height');
  // Wait annotations describe the itinerary before arrival, not the landed state.
  // Derive visibility from the clock so replay/scrubbing restores them as well.
  for(const child of this.root.children)if(child.name.startsWith('twin-wait-badge-'))child.visible=p.phase!=='arrived';
  // GLB front is +Z; after Y-up→Z-up it points south, hence the extra half-turn.
  this.drone.position.set(x,y,z);this.drone.rotation.z=Math.PI-p.headingRad;this.mixer.update(delta/1000);
  // Labels remain readable in both close and archipelago views.
  const distance=this.api.camera?.position.distanceTo(this.drone.position)||10000;
  const span=droneSpan(distance,this.nativeSpan,tail);this.scale=span/this.nativeSpan;this.model.scale.setScalar(this.scale);this.model.position.z=-this.modelBottom*this.scale;this.drone.userData.displaySpan=span;this.drone.userData.modelScale=this.scale;
  this.label.visible=!p.ground&&!tail;this.label.position.z=span*1.2;
  const labels=[this.label,...this.root.children.filter(o=>o.name.startsWith('twin-wait-badge-'))],occupied=[];
  for(const label of labels){const world=label.getWorldPosition(new this.api.THREE.Vector3()),v=world.clone().project(this.api.camera),depth=-world.applyMatrix4(this.api.camera.matrixWorldInverse).z,h=labelWorldHeight(depth,this.api.camera.fov,innerHeight);
   label.scale.set(h*8,h,1);const x=(v.x+1)*innerWidth/2,y=(1-v.y)*innerHeight/2;
   if(label.visible){label.visible=depth>0&&Math.abs(v.x)<1&&Math.abs(v.y)<1&&!occupied.some(p=>Math.abs(p.x-x)<148&&Math.abs(p.y-y)<22);if(label.visible)occupied.push({x,y});}
  }
  const v=this.drone.position.clone().project(this.api.camera);
  return {...p,alt:z,hour,requestId:this.requestId,risk:riskAt(this.route,hour),totalRisk:this.route.total_risk,
    progress:Math.max(0,Math.min(1,(hour-this.route.depart_h)/(this.route.arrive_h-this.route.depart_h))),screen:{x:v.x,y:v.y,z:v.z,inView:Math.abs(v.x)<=1&&Math.abs(v.y)<=1&&v.z>=-1&&v.z<=1}};
 }
 release(){for(const fn of this.off.splice(0))fn();this.mixer?.stopAllAction();this.root.removeFromParent();this.root.traverse(o=>{o.geometry?.dispose();for(const m of [o.material].flat().filter(Boolean)){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}});}
 dispose(){this.disposed=true;this.release();}
}
