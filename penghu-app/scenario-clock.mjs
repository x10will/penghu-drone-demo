export const DAY_SWEEP_MS = 34000;
export const FLIGHT_LEG_MS = 7000;
export const HOLD_MS = 3000;
export const FLIGHT_LEAD_H = 0.75;

const finite = (n, name) => { if (!Number.isFinite(n)) throw new RangeError(`${name} must be finite`); };

// Warp wall time only: each route gets 7 s airborne and each ground hold 3 s.
export function flightSegments(itinerary) {
  const routes=itinerary.routes||[itinerary],segments=[];
  const add=(start,end,ms)=>{if(end>start)segments.push({start,end,ms});};
  add(itinerary.depart_h-FLIGHT_LEAD_H,itinerary.depart_h,HOLD_MS);
  routes.forEach((route,index)=>{
    if(index)add(routes[index-1].arrive_h,route.depart_h,HOLD_MS);
    const waits=(route.waits||[]).slice().sort((a,b)=>a.t0_h-b.t0_h);
    const airborne=route.arrive_h-route.depart_h-waits.reduce((sum,w)=>sum+w.t1_h-w.t0_h,0);
    let cursor=route.depart_h;
    for(const wait of waits){add(cursor,wait.t0_h,FLIGHT_LEG_MS*(wait.t0_h-cursor)/airborne);add(wait.t0_h,wait.t1_h,HOLD_MS);cursor=wait.t1_h;}
    add(cursor,route.arrive_h,FLIGHT_LEG_MS*(route.arrive_h-cursor)/airborne);
  });
  return segments;
}

// No timers or DOM: the extension supplies elapsed onFrame milliseconds.
// Prepare/commit lets the frame loader hold visible time until both frames exist.
export class ScenarioClock {
  #state;
  #flight = null;
  #pending = null;

  constructor() { this.reset(); }

  snapshot() { return { ...this.#state }; }

  reset() {
    this.#state = { hour: 0, mode: 'playing', rate: 1 };
    this.#flight = null;
    this.#pending = null;
    return this.snapshot();
  }

  setClock({ hour, playing, rate } = {}) {
    if (hour !== undefined) finite(hour, 'hour');
    if (rate !== undefined) { finite(rate, 'rate'); if (rate <= 0) throw new RangeError('rate must be positive'); }
    if (playing !== undefined && typeof playing !== 'boolean') throw new TypeError('playing must be boolean');
    const next = { ...this.#state };
    if (hour !== undefined) next.hour = Math.max(0, Math.min(24, hour));
    if (rate !== undefined) next.rate = rate;
    if (next.mode === 'flying') next.mode = 'paused';
    if (playing !== undefined) next.mode = playing ? 'playing' : 'paused';
    this.#state = next;
    this.#flight = null;
    this.#pending = null;
    return this.snapshot();
  }

  fly(route) {
    finite(route.depart_h, 'depart_h'); finite(route.arrive_h, 'arrive_h');
    if (route.arrive_h < route.depart_h) throw new RangeError('arrival precedes departure');
    const segments=flightSegments(route);
    this.#flight = { start: route.depart_h - FLIGHT_LEAD_H, end: route.arrive_h, segments,total:segments.reduce((sum,s)=>sum+s.ms,0),elapsed: 0 };
    this.#state = { ...this.#state, hour: this.#flight.start, mode: 'flying' };
    this.#pending = null;
    return this.snapshot();
  }

  prepareAdvance(elapsedMs) {
    finite(elapsedMs, 'elapsedMs');
    if (elapsedMs < 0) throw new RangeError('elapsedMs must not be negative');
    const state = { ...this.#state };
    let flight = this.#flight ? { ...this.#flight } : null;
    if (state.mode === 'playing') state.hour = (state.hour + elapsedMs / DAY_SWEEP_MS * 24 * state.rate) % 24;
    if (state.mode === 'flying') {
      flight.elapsed = Math.min(flight.total, flight.elapsed + elapsedMs);
      let remaining=flight.elapsed;
      for(const segment of flight.segments){if(remaining<=segment.ms){state.hour=segment.start+(segment.end-segment.start)*remaining/segment.ms;break;}remaining-=segment.ms;}
      if (flight.elapsed === flight.total) { state.hour=flight.end;state.mode = 'paused'; flight = null; }
    }
    this.#pending = Object.freeze({ state: Object.freeze(state), flight: flight ? Object.freeze(flight) : null });
    return this.#pending;
  }

  commit(proposal) {
    if (!proposal || proposal !== this.#pending) return false;
    this.#state = { ...proposal.state };
    this.#flight = proposal.flight ? { ...proposal.flight } : null;
    this.#pending = null;
    return true;
  }

  advance(elapsedMs) { this.commit(this.prepareAdvance(elapsedMs)); return this.snapshot(); }
}
