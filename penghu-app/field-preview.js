import {initMapCredit} from './attribution.mjs';
// Field-only integration surface; no route form, WebSocket client or drone.
const iframe=document.getElementById('viewer'),time=document.getElementById('time'),slider=document.getElementById('hour'),play=document.getElementById('play');
const disposeCredit=initMapCredit(document.querySelector('.map-credit'),document.querySelector('main'),document.getElementById('viewer'));
const state={ready:null,clock:null,coverage:null,errors:[]};
function send(type,payload){iframe.contentWindow.postMessage({channel:'panel-core.map',version:1,type,payload},location.origin);}
function command(name,payload){if(!state.ready)throw new Error('Extension not ready');send('appCommand',{name,payload});}
function receive(event){
  if(event.source!==iframe.contentWindow||event.origin!==location.origin)return;
  const m=event.data;if(m?.channel!=='panel-core.map'||m.version!==1||m.type!=='appEvent')return;
  const {name,payload}=m.payload;
  if(name==='twin:coverage')state.coverage=payload;
  if(name==='twin:clock'){
    state.clock=payload;const minutes=Math.floor(payload.hour*60);
    time.textContent=`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
    slider.value=payload.hour;play.textContent=payload.mode==='playing'?'暫停':'播放';
  }
  if(name==='twin:ready'){
    state.ready=payload;play.disabled=false;slider.disabled=false;
    document.getElementById('status').firstChild.textContent='場域已載入 · 拖曳旋轉／滾輪縮放';
    document.getElementById('limit').textContent=payload.legend.safetyLimit.toFixed(1);
    document.getElementById('hatch').textContent=payload.legend.hatchMargin;
  }
  if(name==='twin:error'||name==='extension-error'){state.errors.push(payload);document.getElementById('error').textContent=payload.message;}
}
window.addEventListener('message',receive);
iframe.addEventListener('load',()=>send('hello',{}));
const viewerURL=new URL('../viewer/docs/viewer-3d/index.html',import.meta.url);
viewerURL.search=new URLSearchParams({site:'penghu',embed:'1',ext:new URL('./penghu-layers.js',import.meta.url).pathname});iframe.src=viewerURL.href;
play.addEventListener('click',()=>command('twin:clock',{playing:state.clock?.mode!=='playing'}));
slider.addEventListener('input',()=>command('twin:clock',{hour:Number(slider.value),playing:false}));
window.fieldPreview={state,command,flyTo:target=>send('flyTo',{target})};
window.addEventListener('pagehide',()=>{disposeCredit();window.removeEventListener('message',receive);},{once:true});
