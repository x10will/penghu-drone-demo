export function connectEmbed(iframe,onEvent){
 let ready=false,closed=false;const queue=[];
 const send=(type,payload)=>{if(!closed)iframe.contentWindow.postMessage({channel:'panel-core.map',version:1,type,payload},location.origin);};
 const command=(name,payload)=>{if(ready)send('appCommand',{name,payload});else queue.push({name,payload});};
 const receive=e=>{if(closed||e.source!==iframe.contentWindow||e.origin!==location.origin)return;const m=e.data;
  if(m?.channel!=='panel-core.map'||m.version!==1)return;
  if(m.type==='appEvent'){if(m.payload.name==='twin:ready'){ready=true;for(const item of queue.splice(0))send('appCommand',item);}onEvent(m.payload.name,m.payload.payload);}
  else if(m.type==='select')onEvent('twin:pick',m.payload);
 };
 const loaded=()=>{ready=false;send('hello',{});};
 iframe.addEventListener('load',loaded);window.addEventListener('message',receive);
 return {command,flyTo:target=>send('flyTo',{target}),dispose(){closed=true;queue.length=0;window.removeEventListener('message',receive);iframe.removeEventListener('load',loaded);}};
}
