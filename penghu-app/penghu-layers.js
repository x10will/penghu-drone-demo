import {FieldFrames} from './field-frames.js';
import {ScenarioClock} from './scenario-clock.mjs';
import {frameLerp} from './timeline.mjs';
import {cellStyle,sampledGrid,HATCH_MARGIN} from './field-math.mjs';
import {labelWorldHeight} from './display-math.mjs';
import {FollowCamera} from './follow-camera.mjs';

const PAINT_MS=50, CELL_PX=8;

export default async function setup(api) {
  const {THREE}=api, clock=new ScenarioClock();
  const loader=new FieldFrames(new URL('../data/danger_frames/danger',import.meta.url).href);
  let disposed=false,mesh,texture,geometry,material,meta,canvas,ctx,lastTime=null,elapsed=0,busy=false,epoch=0,paints=0;
  const off=[];
  let actor=null,follow=false,followMode='center',routeEpoch=0;
  const followCamera=new FollowCamera(api);
  const emit=(name,payload)=>{if(!disposed)api.appEvent(name,payload);};
  const fail=error=>{if(!disposed&&error.name!=='AbortError')emit('twin:error',{message:error.message});};
  const cleanup=()=>{
    if(disposed)return;
    disposed=true;epoch++;routeEpoch++;actor?.dispose();loader.dispose();for(const unsubscribe of off)unsubscribe();
    mesh?.removeFromParent();geometry?.dispose();material?.dispose();texture?.dispose();
  };
  api.onDispose(cleanup);
  // Scene sprites are public facade objects. Clone their materials so the
  // viewer's own visibility LOD cannot undo collision culling; restore on exit.
  const signs=[];api.scene.traverse(o=>{if(o.isSprite){const material=o.material,scale=o.scale.clone();o.material=material.clone();o.material.sizeAttenuation=true;signs.push({o,material,scale,aspect:scale.x/scale.y});}});
  off.push(()=>{for(const s of signs){s.o.material.dispose();s.o.material=s.material;s.o.scale.copy(s.scale);}});
  function scaleSigns(){
    if(!api.camera)return;const occupied=[];
    for(const s of [...signs].sort((a,b)=>a.o.position.distanceToSquared(api.camera.position)-b.o.position.distanceToSquared(api.camera.position))){
      const world=s.o.getWorldPosition(new THREE.Vector3()),p=world.clone().project(api.camera),depth=-world.clone().applyMatrix4(api.camera.matrixWorldInverse).z;
      const h=labelWorldHeight(depth,api.camera.fov,innerHeight),width=Math.min(180,18*s.aspect),x=(p.x+1)*innerWidth/2,y=(1-p.y)*innerHeight/2;
      s.o.scale.set(h*width/18,h,1);const r={x:x-width*s.o.center.x,y:y-18*(1-s.o.center.y),w:width,h:18};
      s.o.material.visible=depth>0&&Math.abs(p.x)<1&&Math.abs(p.y)<1&&!occupied.some(a=>r.x<a.x+a.w+4&&r.x+r.w+4>a.x&&r.y<a.y+a.h+4&&r.y+r.h+4>a.y);
      if(s.o.material.visible)occupied.push(r);
    }
  }
  const gesture=()=>{if(follow){follow=false;followCamera.reset();emit('twin:follow-paused',{});}};
  for(const name of ['pointerdown','touchstart','wheel']){document.addEventListener(name,gesture,{passive:true});off.push(()=>document.removeEventListener(name,gesture));}
  window.addEventListener('keydown',gesture,true);off.push(()=>window.removeEventListener('keydown',gesture,true));

  function syncActor(delta=0){
    const progress=actor?.sync(clock.snapshot().hour,delta,follow&&followMode==='tail');if(!progress)return;
    if(follow){
      const position=actor.drone.position;
      try{followCamera.sync(position,progress.headingRad,delta,followMode);}catch(error){gesture();fail(error);}
      api.camera.updateMatrixWorld();const v=position.clone().project(api.camera);progress.screen={x:v.x,y:v.y,z:v.z,inView:Math.abs(v.x)<=1&&Math.abs(v.y)<=1&&v.z>=-1&&v.z<=1};
      const aim=api.camera.getWorldDirection(new THREE.Vector3());progress.cameraYawRad=Math.atan2(aim.x,aim.y);
    }
    progress.follow=follow;
    progress.followMode=follow?followMode:null;
    emit('twin:flight',progress);
  }

  function paint(hour) {
    const {i0,i1,frac}=frameLerp(meta,hour),a=loader.getFrame(i0),b=loader.getFrame(i1);
    if(!a||!b)throw new Error('Field frame pair is not ready');
    const [rows,cols]=meta.grid,blocked=new Uint8Array(rows*cols);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let noFlyCells=0;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const danger=a.danger[r][c]+(b.danger[r][c]-a.danger[r][c])*frac;
      const margin=a.margin[r][c]+(b.margin[r][c]-a.margin[r][c])*frac;
      const style=cellStyle(danger,margin,!!meta.land[r][c],meta.danger_clamp,meta.safety_limit);
      const x=c*CELL_PX,y=r*CELL_PX;
      ctx.fillStyle=`rgba(${style.rgba.join(',')})`;ctx.fillRect(x,y,CELL_PX,CELL_PX);
      if(style.hatch){ctx.strokeStyle='rgba(255,255,255,0.22)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y+CELL_PX);ctx.lineTo(x+CELL_PX,y);ctx.stroke();}
      if(style.blocked){blocked[r*cols+c]=1;noFlyCells++;}
    }
    // Trace the boundary of forbidden water, not every cell, so the field stays readable.
    ctx.strokeStyle='rgba(255,190,204,0.95)';ctx.lineWidth=1;ctx.beginPath();
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(blocked[r*cols+c]){
      const x=c*CELL_PX,y=r*CELL_PX,s=CELL_PX;
      if(r===0||!blocked[(r-1)*cols+c]){ctx.moveTo(x,y);ctx.lineTo(x+s,y);}
      if(r===rows-1||!blocked[(r+1)*cols+c]){ctx.moveTo(x,y+s);ctx.lineTo(x+s,y+s);}
      if(c===0||!blocked[r*cols+c-1]){ctx.moveTo(x,y);ctx.lineTo(x,y+s);}
      if(c===cols-1||!blocked[r*cols+c+1]){ctx.moveTo(x+s,y);ctx.lineTo(x+s,y+s);}
    }
    ctx.stroke();texture.needsUpdate=true;paints++;
    const state={...clock.snapshot(),i0,i1,frac,noFlyCells,paints};
    mesh.userData.fieldState=state;
    emit('twin:clock',state);
    syncActor();
  }

  async function command(name,payload={}) {
    if(disposed)return;
    if(name==='twin:view-reset'){if(api.setCameraPose(api.site.cameraPosition,[0,0,api.site.cameraTargetZ??0])!==true)fail(new Error('無法還原預設視角'));return;}
    if(name==='twin:clear'){routeEpoch++;epoch++;busy=false;actor?.dispose();actor=null;follow=false;clock.setClock({playing:true});elapsed=0;lastTime=null;return;}
    if(name==='twin:follow'){follow=!!payload.enabled;followMode=payload.mode==='tail'?'tail':'center';followCamera.reset();syncActor();return;}
    if(name==='twin:route'){
      const token=++routeEpoch,clockToken=++epoch;actor?.dispose();actor=null;busy=true;
      let next;
      try{
        const {RouteActor}=await import('./route-actor.js');next=new RouteActor(api,payload.route,payload.requestId);
        await next.load();if(disposed||token!==routeEpoch){next.dispose();return;}actor=next;
        if(clockToken===epoch){
          const hour=payload.route.depart_h-0.75,pair=frameLerp(meta,hour);await loader.ensure(pair.i0,pair.i1);
          if(disposed||token!==routeEpoch)return;
          if(clockToken===epoch){clock.setClock({hour,playing:false});paint(hour);}
        }
        syncActor();emit('twin:route-ready',{requestId:payload.requestId,model:'CesiumDrone.glb'});
      }catch(error){next?.dispose();if(actor===next)actor=null;fail(error);}finally{if(token===routeEpoch&&clockToken===epoch){busy=false;elapsed=0;lastTime=null;}}return;
    }
    if(name==='twin:fly'){
      if(!actor)return;const token=++epoch;busy=true;
      try{for(let i=0;i<meta.frame_count;i+=8)await loader.ensure(i,Math.min(i+7,meta.frame_count-1));
        if(disposed||token!==epoch)return;
        if(payload.frameRoute&&!follow){
          // Let the viewer's resize observer update its projection after collapse.
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          if(disposed||token!==epoch)return;
          if(!follow&&actor.frameRoute(innerWidth,innerHeight)!==true)fail(new Error('無法調整航線視角'));
        }
        clock.fly(actor.route);elapsed=0;lastTime=null;paint(clock.snapshot().hour);
      }catch(error){fail(error);}finally{if(token===epoch)busy=false;}return;
    }
    if(name!=='twin:clock')return;
    const token=++epoch;busy=true;
    try{
      const trial=new ScenarioClock();
      const current=clock.snapshot();trial.setClock({hour:current.hour,playing:current.mode==='playing',rate:current.rate});
      const target=trial.setClock(payload),pair=frameLerp(meta,target.hour);
      await loader.ensure(pair.i0,pair.i1);
      if(disposed||token!==epoch)return;
      clock.setClock(payload);paint(clock.snapshot().hour);elapsed=0;lastTime=null;
    }catch(error){fail(error);}finally{if(token===epoch)busy=false;}
  }

  try {
    meta=await loader.load();if(disposed)return cleanup;
    const grid=sampledGrid(meta.bbox,api.geoToLocal,api.sampleGround,250);
    const centers={land:{total:0,finite:0,minZ:Infinity,maxZ:-Infinity},sea:{total:0,finite:0,minZ:Infinity,maxZ:-Infinity},pads:[]};
    const [west,south,east,north]=meta.bbox,[rows,cols]=meta.grid;
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const lat=north-(r+0.5)*(north-south)/rows,lon=west+(c+0.5)*(east-west)/cols;
      const z=api.sampleGround(...api.geoToLocal(lat,lon)),group=centers[meta.land[r][c]?'land':'sea'];
      group.total++;if(Number.isFinite(z)){group.finite++;group.minZ=Math.min(group.minZ,z);group.maxZ=Math.max(group.maxZ,z);}
    }
    for(const pad of meta.pads){const z=api.sampleGround(...api.geoToLocal(pad.lat,pad.lng));centers.pads.push({id:pad.id,z,finite:Number.isFinite(z),aboveFlightBand:Number.isFinite(z)&&z>=100});}
    const coverage={...grid.report,centers};emit('twin:coverage',coverage);
    if(grid.report.missing||centers.land.finite!==centers.land.total||centers.sea.finite!==centers.sea.total||centers.pads.some(p=>!p.finite))throw new Error('Incomplete terrain sampling coverage; viewer lane must resolve missing heights');
    geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(grid.positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(grid.uv,2));geometry.setIndex(new THREE.BufferAttribute(grid.indices,1));
    canvas=document.createElement('canvas');canvas.width=cols*CELL_PX;canvas.height=rows*CELL_PX;ctx=canvas.getContext('2d');
    texture=new THREE.CanvasTexture(canvas);texture.minFilter=THREE.NearestFilter;texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;texture.colorSpace=THREE.SRGBColorSpace;
    // Canvas top is row 0 (north). Default flipY maps that edge to v=1 (north).
    material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
    mesh=new THREE.Mesh(geometry,material);mesh.name='penghu-danger-field';mesh.renderOrder=3;mesh.raycast=()=>{};api.scene.add(mesh);
    await loader.ensure(0,1);if(disposed)return cleanup;
    paint(0);off.push(api.onAppCommand(command));
    off.push(api.onFrame(now=>{
      if(disposed)return;
      scaleSigns();
      if(lastTime===null){lastTime=now;return;}
      const delta=Math.max(0,now-lastTime);lastTime=now;
      if(actor)syncActor(delta);
      if(busy){elapsed=0;return;}elapsed+=delta;if(elapsed<PAINT_MS)return;
      const duration=elapsed;elapsed=0;
      if(clock.snapshot().mode==='paused')return;
      const proposal=clock.prepareAdvance(duration),pair=frameLerp(meta,proposal.state.hour);
      if(loader.isLoaded(pair.i0)&&loader.isLoaded(pair.i1)){if(clock.commit(proposal))paint(clock.snapshot().hour);return;}
      const token=epoch;busy=true;
      loader.ensure(pair.i0,pair.i1).then(()=>{if(!disposed&&token===epoch&&clock.commit(proposal))paint(clock.snapshot().hour);}).catch(fail).finally(()=>{if(token===epoch)busy=false;});
    }));
    emit('twin:ready',{coverage,paintHz:1000/PAINT_MS,textureSize:[canvas.width,canvas.height],frameCount:meta.frame_count,
      legend:{safetyLimit:meta.safety_limit,hatchMargin:HATCH_MARGIN,dangerClamp:meta.danger_clamp},clock:clock.snapshot()});
    return cleanup;
  }catch(error){fail(error);cleanup();return cleanup;}
}
