// Pure presentation helpers; no engine or viewer dependencies.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Original engine responses remain untouched inside this presentation wrapper.
export const TURNAROUND_MIN = 30;
export const RETURN_LATEST = '23:00';
export function returnRequest(outbound) {
  const minute=Math.ceil((outbound.arrive_h*60+TURNAROUND_MIN)-1e-9);
  if(minute>23*60)return null;
  return {from_node:outbound.to_id,to_node:outbound.from_id,
    depart_earliest:`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,depart_latest:RETURN_LATEST};
}
export function makeItinerary(outbound,back=null) {
  if(back&&(back.from_id!==outbound.to_id||back.to_id!==outbound.from_id||back.depart_h<outbound.arrive_h+TURNAROUND_MIN/60-1e-9))throw new Error('Invalid return schedule');
  const routes=back?[outbound,back]:[outbound];
  return {routes,depart_h:outbound.depart_h,arrive_h:routes.at(-1).arrive_h,
    total_risk:routes.reduce((sum,r)=>sum+r.total_risk,0),turnaround_min:back?(back.depart_h-outbound.arrive_h)*60:0};
}

// Fit cosmetic pad connectors inside the existing first/last segment intervals.
// The caller retains the original route for every schedule and risk calculation.
export function displayPath(route, origin, destination) {
  const path=route.path.map(p=>({...p}));
  if(path.length===1)return [{...path[0],lat:origin.lat,lng:origin.lng}];
  const distance=(a,b)=>Math.hypot(a.lat-b.lat,(a.lng-b.lng)*Math.cos((a.lat+b.lat)*Math.PI/360));
  const result=[];
  for(let i=0;i<path.length-1;i++){
    const a=path[i],b=path[i+1],points=[a,b];
    if(i===0)points.unshift({...a,lat:origin.lat,lng:origin.lng});
    if(i===path.length-2)points.push({...b,lat:destination.lat,lng:destination.lng});
    const spans=points.slice(1).map((p,j)=>distance(points[j],p)),total=spans.reduce((sum,n)=>sum+n,0);let traveled=0;
    points.forEach((p,j)=>{
      if(j)traveled+=spans[j-1];
      const t_h=j===0?a.t_h:j===points.length-1?b.t_h:a.t_h+(b.t_h-a.t_h)*(total?traveled/total:j/(points.length-1));
      if(!i||j)result.push({...p,t_h});
    });
  }
  return result;
}

export function frameLerp(meta, hour) {
  const index = clamp(hour * 60 / meta.frame_minutes, 0, meta.frame_count - 1);
  const i0 = Math.floor(index), i1 = Math.min(i0 + 1, meta.frame_count - 1);
  return { i0, i1, frac: i0 === i1 ? 0 : index - i0 };
}

function positionAt(path, hour) {
  // At duplicate timestamps the last point wins; never divide by a zero span.
  let index = 0;
  while (index + 1 < path.length && path[index + 1].t_h <= hour) index++;
  const a = path[index], b = path[index + 1];
  const fraction = b ? clamp((hour - a.t_h) / (b.t_h - a.t_h), 0, 1) : 0;
  return { index, lat: a.lat + ((b?.lat ?? a.lat) - a.lat) * fraction,
    lng: a.lng + ((b?.lng ?? a.lng) - a.lng) * fraction };
}

export function poseAt(route, hour) {
  if(route?.routes){
    const [outbound,back]=route.routes;
    if(back&&hour>=outbound.arrive_h&&hour<back.depart_h){
      const parked=poseAt(outbound,outbound.arrive_h),target=poseAt(back,back.depart_h).headingRad;
      const fraction=(hour-outbound.arrive_h)/(back.depart_h-outbound.arrive_h);
      const delta=Math.atan2(Math.sin(target-parked.headingRad),Math.cos(target-parked.headingRad));
      return {...parked,headingRad:parked.headingRad+delta*fraction*fraction*(3-2*fraction),phase:'turnaround-hold',padId:outbound.to_id,legIndex:1};
    }
    const legIndex=back&&hour>=back.depart_h?1:0;
    return {...poseAt(route.routes[legIndex],hour),legIndex};
  }
  if (!route?.path?.length) return null;
  const wait = (route.waits || []).find(w => hour >= w.t0_h && hour < w.t1_h);
  const phase = hour < route.depart_h ? 'origin-hold' : hour >= route.arrive_h ? 'arrived'
    : wait ? 'pad-wait' : 'airborne';
  const point = positionAt(route.path, clamp(wait ? wait.t0_h : hour, route.depart_h, route.arrive_h));
  let headingRad = 0;
  // Preserve the incoming tangent at arrival rather than snapping north.
  if(point.index===route.path.length-1)for(let i=point.index-1;i>=0;i--){
    const previous=route.path[i];if(previous.lat===point.lat&&previous.lng===point.lng)continue;
    headingRad=Math.atan2((point.lng-previous.lng)*Math.cos(point.lat*Math.PI/180),point.lat-previous.lat);break;
  }
  for (let i = point.index + 1; i < route.path.length; i++) {
    const next = route.path[i];
    if (next.lat === point.lat && next.lng === point.lng) continue;
    // Clockwise from north; actor module applies the model-axis rotation.
    headingRad = Math.atan2((next.lng - point.lng) * Math.cos(point.lat * Math.PI / 180), next.lat - point.lat);
    break;
  }
  return { lat: point.lat, lng: point.lng, headingRad, phase, ground: phase !== 'airborne',
    altitudeASL: phase === 'airborne' ? 100 : null, padId: wait?.pad_id ?? null };
}

export function riskAt(route, hour) {
  if(route?.routes)return hour>=route.arrive_h?route.total_risk:route.routes.reduce((sum,r)=>sum+riskAt(r,hour),0);
  if (!route || hour < route.depart_h) return 0;
  if (hour >= route.arrive_h) return route.total_risk;
  const wait = (route.waits || []).find(w => hour >= w.t0_h && hour < w.t1_h);
  const t = wait ? wait.t0_h : hour;
  let risk = 0;
  for (const leg of route.legs) {
    if (t >= leg.t1_h) risk += leg.risk;
    else if (t > leg.t0_h && leg.t1_h > leg.t0_h) risk += leg.risk * (t - leg.t0_h) / (leg.t1_h - leg.t0_h);
  }
  return clamp(risk, 0, route.total_risk);
}

// Zero delay is not a delay: the origin badge and the details row say so plainly.
export function delayWording(delayMin) {
  const minutes = Math.round(Number(delayMin));
  return minutes > 0 ? {badge: `延後 ${delayMin} 分 · 地面待命`, row: `${delayMin} 分鐘`}
    : {badge: '準點起飛', row: '不延後'};
}

// One line a person can read without opening the details: each leg's times and the turnaround.
export function itinerarySummary(itinerary) {
  const [outbound, back] = itinerary.routes, span = route => `${route.depart_label} → ${route.arrive_label}`;
  return back ? `出程 ${span(outbound)} · 整備 ${Math.round(itinerary.turnaround_min)} 分 · 回程 ${span(back)}`
    : `出程 ${span(outbound)}`;
}

export function safetyCost(route, safetyLimit) {
  const actualMin = Math.round((route.arrive_h - route.depart_h) * 60);
  const directMin = Math.round(route.direct_h * 60);
  return { actualMin, directMin, extraMin: Math.max(0, actualMin - directMin),
    delayMin: route.delay_min, waitedMin: route.waited_min, slack: safetyLimit - route.max_cell_total };
}
