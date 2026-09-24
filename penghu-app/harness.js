import {createBottomSheet} from './bottom-sheet.mjs';
import {initMapCredit} from './attribution.mjs';
import {loadField,plan} from './planner.mjs';
import {connectEmbed} from './embed-transport.js';
import {safetyCost,makeItinerary,returnRequest,TURNAROUND_MIN,RETURN_LATEST} from './timeline.mjs';
const $=id=>document.getElementById(id),state={ready:false,online:false,route:null,itinerary:null,flight:null,clock:null,errors:[],response:null,returnResponse:null,action:'plan',routeReady:false};
let fieldLoadError=null;
let pendingLeg=null,wantsReturn=false,field=null,serial=0,pending=null;
let actionUnlockAt=0,actionTimer,flightStarted=false;
const phoneSheet=createBottomSheet($('route-panel'));
const disposeCredit=initMapCredit(document.querySelector('.map-credit'),$('map'),$('viewer'));
const peekObserver=new MutationObserver(()=>phoneSheet.setSummary(!$('ledger').hidden ? [...$('ledger').childNodes].map(n=>n.textContent).join(' ') : $('status').textContent));
for(const id of ['status','ledger'])peekObserver.observe($(id),{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
// Move original controls without replacing their state or event handlers.
const desktop=matchMedia('(min-width:701px)');let panelCollapsed=false;
const chevron=document.createElement('button');chevron.id='panel-toggle';chevron.type='button';document.querySelector('header').append(chevron);
const strip=document.createElement('div');strip.id='desktop-strip';document.querySelector('main').prepend(strip);
const anchors=['ledger','plan','play'].map(id=>{const element=$(id),anchor=document.createComment(id);element.before(anchor);return {element,anchor};});
function setPanelCollapsed(value){
 panelCollapsed=desktop.matches&&value;document.body.classList.toggle('panel-collapsed',panelCollapsed);
 chevron.textContent=panelCollapsed?'‹ 展開面板':'› 收合面板';chevron.setAttribute('aria-expanded',String(!panelCollapsed));
 for(const {element,anchor}of anchors)if(panelCollapsed)strip.append(element);else anchor.after(element);
 const doc=$('viewer').contentDocument;if(doc?.head){let style=doc.getElementById('penghu-desktop-nav');if(!style){style=doc.createElement('style');style.id='penghu-desktop-nav';doc.head.append(style);}style.textContent=panelCollapsed?'#dt-embed-navigation,#viewpoints{display:none!important}':`@media(max-width:700px){
 html.dt-embed #dt-embed-navigation{top:8px!important;right:8px!important;gap:4px!important}
 html.dt-embed #dt-embed-navigation button{min-height:32px!important;min-width:32px!important;padding:3px 6px!important;font-size:12px!important}
 html.dt-embed #dt-embed-navigation #viewpoints{gap:4px!important;flex-direction:row!important;width:auto!important}
 html.dt-embed #dt-embed-navigation #viewpoints>.vp-btn{width:auto!important;flex:0 0 auto!important;min-width:0!important;min-height:28px!important;padding:2px 6px!important;font-size:10px!important}
 html.dt-embed #dt-embed-navigation #mobile-compass[hidden]{display:none!important}
 }`;}
}
chevron.addEventListener('click',()=>setPanelCollapsed(!panelCollapsed));desktop.addEventListener('change',()=>setPanelCollapsed(false));$('viewer').addEventListener('load',()=>setPanelCollapsed(panelCollapsed));setPanelCollapsed(false);
const map=connectEmbed($('viewer'),(name,p)=>{
 if(name==='twin:ready'){state.ready=true;$('status').textContent=fieldLoadError||'場域已就緒';$('play').disabled=$('hour').disabled=false;refresh();}
 if(name==='twin:clock'){state.clock=p;const m=Math.floor(p.hour*60);$('time').textContent=`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;$('hour').value=p.hour;$('play').textContent=(p.mode!=='paused')?'暫停':'播放';}
 if(name==='twin:route-ready'&&state.itinerary&&p.requestId===state.response?.request_id){state.routeReady=true;state.action='fly';refresh();$('status').textContent='航線已提出 — 請目視確認';}
 if(name==='twin:flight'&&state.itinerary&&p.requestId===state.response?.request_id){
  if(state.action==='reset'&&state.clock?.mode==='flying'){flightStarted=true;refresh();}
  state.flight=p;$('ledger').hidden=false;const labels={'origin-hold':'地面待命（等待風險回落）','pad-wait':'地面停等','turnaround-hold':'地面待命（折返整備）','airborne':'模擬飛行 · 100 m ASL','arrived':'已抵達'};
  $('ledger').replaceChildren(document.createTextNode(`${p.legIndex===1?'回程 · ':''}${labels[p.phase]}`));const detail=document.createElement('small');detail.textContent=`累計風險 ${p.risk.toFixed(4)} / ${p.totalRisk.toFixed(4)}${['origin-hold','pad-wait','turnaround-hold'].includes(p.phase)?' · 等待不累積':''}`;$('ledger').append(detail);
 }
 if(name==='twin:follow-paused')$('follow').checked=$('tail').checked=false;
 if(name==='twin:error'||name==='extension-error'){state.errors.push(p);$('error').textContent=fieldLoadError||p.message;if(name==='twin:error'&&state.action==='reset'&&!flightStarted){state.action='fly';setPanelCollapsed(false);refresh();}}
});
// Plans in the page (planner.mjs); a newer request or an edit (pending=null) drops an older answer.
const hours=hhmm=>{const [h,m]=hhmm.split(':');return Number(h)+Number(m)/60;};
function requestRoute(fields){
 const id=pending=`traverse-${++serial}`;
 setTimeout(()=>{
  let response;
  try{const result=plan(field,meta.pads,fields.from_node,fields.to_node,hours(fields.depart_earliest),hours(fields.depart_latest));response={type:'route_response',request_id:id,status:result.status,...(result.status==='ok'?{route:result}:{reason_zh:result.reason_zh})};}
  catch(error){response={type:'error',request_id:id,message:error.message};}
  if(pending===id){pending=null;onResponse(response);}
 });
 return id;
}
function onResponse(r){
 if(!pendingLeg)return;
 if(pendingLeg==='return'){state.returnResponse=r;deliver();return;}
 state.response=r;pendingLeg=null;
 if(r.status==='ok'){
  state.route=r.route;
  if(wantsReturn){const request=returnRequest(r.route);if(request){pendingLeg='return';render(r.route);$('status').textContent='出程已提出 · 計算回程…';requestRoute(request);return;}
   state.returnResponse={status:'no_safe_route',reason_zh:'折返整備後已超過同日 23:00 回程起飛期限'};
  }deliver();
 }
 else{clear();$('summary').hidden=false;const h=document.createElement('h2');h.textContent=r.status==='no_safe_route'?'無安全航線':'規劃失敗';const reason=document.createElement('p');reason.textContent=r.reason_zh||r.message;$('summary').replaceChildren(h,reason);$('status').textContent='場域持續播放';}
}
function refresh(){const label={plan:'規劃航線',loading:'規劃航線',fly:'模擬飛行',reset:'重設'}[state.action];if($('plan').textContent!==label){actionUnlockAt=performance.now()+800;clearTimeout(actionTimer);actionTimer=setTimeout(refresh,810);}$('plan').textContent=label;$('plan').disabled=performance.now()<actionUnlockAt||state.action==='loading'||(state.action==='reset'&&!flightStarted)||(state.action==='plan'&&!(state.ready&&state.online));$('replay').disabled=!state.routeReady;}
function clear(){setPanelCollapsed(false);pendingLeg=null;state.route=null;state.itinerary=null;state.returnResponse=null;state.flight=null;state.routeReady=false;state.action='plan';$('ledger').hidden=true;$('follow').checked=$('tail').checked=false;$('rationale').replaceChildren();map.command('twin:clear',{});refresh();}
function fly(){if(!state.routeReady)return;flightStarted=false;state.action='reset';refresh();setPanelCollapsed(true);phoneSheet.collapse();map.command('twin:fly',{frameRoute:desktop.matches});}
function reset(){clear();if(desktop.matches)map.command('twin:view-reset',{});pending=null;state.response=null;$('route-form').reset();$('from').value='N04';$('to').value='N05';$('rate').value='1';$('details').open=false;$('summary').hidden=true;$('error').textContent='';$('status').textContent='場域已就緒';map.command('twin:clock',{hour:0,playing:true,rate:1});}
function deliver(){
 pendingLeg=null;
 try{state.itinerary=makeItinerary(state.route,state.returnResponse?.status==='ok'?state.returnResponse.route:null);}
 catch(error){state.returnResponse={status:'error',reason_zh:'回程排程與出程不一致'};state.itinerary=makeItinerary(state.route);}
 render(state.route);map.command('twin:route',{requestId:state.response.request_id,route:state.itinerary});
}
function renderLeg(r,label){
 const section=document.createElement('section');section.className='itinerary-leg';section.dataset.leg=label;const h=document.createElement('h2');h.textContent=`${label} · ${r.depart_label} 出發 → ${r.arrive_label} 抵達`;section.append(h);
 const dl=document.createElement('dl');for(const [key,value] of [['延後起飛',`${r.delay_min} 分`],['途中停等',`${r.waited_min} 分`],['本程風險',r.total_risk.toFixed(2)],['全程最大單格',r.max_cell_total.toFixed(2)]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);}section.append(dl);
 const cost=safetyCost(r,meta.safety_limit);for(const text of [`直線理想 ${cost.directMin} 分 → 實際 ${cost.actualMin} 分（安全繞行＋停等 ＋${cost.extraMin} 分）；門檻餘裕 ${cost.slack.toFixed(2)}`,...r.waits.map(w=>`${w.name} 停等 ${w.minutes} 分`)]){const p=document.createElement('p');p.textContent=text;section.append(p);}
 const rationale=document.createElement('p');rationale.textContent=`${label} · ${r.rationale_zh}`;$('rationale').append(rationale);
 $('summary').append(section);
}
function render(r){
 $('summary').hidden=false;$('summary').replaceChildren();$('rationale').replaceChildren();renderLeg(r,'出程');
 if(wantsReturn){
  const hold=document.createElement('p');hold.id='turnaround';hold.textContent=`折返整備至少 ${TURNAROUND_MIN} 分 · 回程起飛期限同日 ${RETURN_LATEST}`;
  if(state.itinerary?.routes.length===2)hold.textContent+=` · 實際地面待命 ${Math.round(state.itinerary.turnaround_min)} 分（等待不累積）`;
  $('summary').append(hold);
  if(state.returnResponse?.status==='ok')renderLeg(state.returnResponse.route,'回程');
  else{const p=document.createElement('p');p.id='return-result';p.textContent=state.returnResponse?`回程 · ${state.returnResponse.status==='no_safe_route'?'無安全航線':'規劃未完成'}：${state.returnResponse.reason_zh||state.returnResponse.message}`:'回程 · 規劃中…';$('summary').append(p);}
 }
 const total=document.createElement('p');total.id='itinerary-total';total.textContent=`已規劃 ${state.itinerary?.routes.length||1} 程 · 合計風險 ${(state.itinerary?.total_risk??r.total_risk).toFixed(4)}`;$('summary').append(total);
 state.action='loading';state.routeReady=false;refresh();$('status').textContent='載入四旋翼與航線…';
}
$('route-form').addEventListener('submit',e=>e.preventDefault());
for(const id of ['earliest','latest'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter')e.preventDefault();});
$('legend-toggle').addEventListener('click',()=>{const open=$('legend').classList.toggle('expanded');$('legend-toggle').setAttribute('aria-expanded',String(open));});
$('plan').addEventListener('click',()=>{if($('plan').disabled||performance.now()<actionUnlockAt)return;if(state.action==='fly'){fly();return;}if(state.action==='reset'){reset();return;}if(state.action!=='plan'||!$('route-form').reportValidity())return;try{clear();wantsReturn=$('roundtrip').checked;pendingLeg='outbound';state.action='loading';refresh();$('summary').hidden=true;$('error').textContent='';$('status').textContent='計算安全航線…';requestRoute({from_node:$('from').value,to_node:$('to').value,depart_earliest:$('earliest').value,depart_latest:$('latest').value});}catch(error){pendingLeg=null;state.action='plan';refresh();$('error').textContent=error.message;}});
for(const id of ['from','to','earliest','latest','roundtrip'])$(id).addEventListener('input',()=>{if(state.route||pendingLeg||state.action!=='plan'||!$('summary').hidden){clear();pending=null;$('summary').hidden=true;$('status').textContent='行程已變更 · 請重新規劃';}});
$('replay').addEventListener('click',fly);
for(const [id,other,mode]of [['follow','tail','center'],['tail','follow','tail']])$(id).addEventListener('change',()=>{if($(id).checked)$(other).checked=false;map.command('twin:follow',{enabled:$(id).checked,mode});});
$('play').addEventListener('click',()=>map.command('twin:clock',{playing:state.clock?.mode==='paused'}));
$('hour').addEventListener('input',()=>map.command('twin:clock',{hour:Number($('hour').value),playing:false}));
$('rate').addEventListener('change',()=>map.command('twin:clock',{rate:Number($('rate').value)}));
const meta=await fetch(new URL('../data/danger_frames/danger_meta.json',import.meta.url)).then(r=>r.json());
for(const id of ['from','to'])for(const pad of meta.pads){const option=document.createElement('option');option.value=pad.id;option.textContent=pad.name;$(id).append(option);}
// state.online: the planner's field has loaded, so 規劃航線 can run.
loadField(meta,new URL('../data/danger_frames/router_field.bin',import.meta.url)).then(f=>{field=f;state.online=true;refresh();},error=>{fieldLoadError=`航線資料載入失敗：${error.message}`;state.online=false;$('status').textContent=$('error').textContent=fieldLoadError;refresh();});
$('from').value='N04';$('to').value='N05';const viewerURL=new URL('../viewer/docs/viewer-3d/index.html',import.meta.url);viewerURL.search=new URLSearchParams({site:'penghu',embed:'1',ext:new URL('./penghu-layers.js',import.meta.url).pathname});$('viewer').src=viewerURL.href;
window.traverse={state,command:map.command};
window.addEventListener('pagehide',()=>{peekObserver.disconnect();phoneSheet.destroy();disposeCredit();map.dispose();},{once:true});
