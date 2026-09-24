// App simulation milliseconds, never inferred from the viewer's display labels.
export function parseFrameMs(search) {
  const value = Number(new URLSearchParams(search).get('frameMs'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function timeInfo(count, frameMs) {
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(frameMs)
      || frameMs <= 0 || !Number.isFinite(count * frameMs)) return null;
  return { frames: count, timeRange: { start: 0, end: count * frameMs, step: frameMs } };
}

export function frameForTime(t, frameMs, count) {
  if (!Number.isFinite(t) || !timeInfo(count, frameMs)) return null;
  return Math.max(0, Math.min(count - 1, Math.floor(t / frameMs)));
}

export function createFrameClock({ frameMs, read, scrub, emit }) {
  let previous = read();
  const observe = () => {
    const next = read();
    if (timeInfo(next.count, frameMs) && next.frame !== previous.frame
        && Number.isInteger(next.frame) && next.frame >= 0 && next.frame < next.count) {
      emit(next.frame * frameMs);
    }
    previous = { ...next };
  };
  previous = { ...previous };
  return {
    observe,
    info: () => timeInfo(read().count, frameMs),
    setTime(t) {
      const frame = frameForTime(t, frameMs, read().count);
      if (frame === null) return;
      observe(); // Deliver an already-pending viewer change before the host command.
      scrub(frame);
      previous = { ...read() }; // Its deferred MutationObserver must not echo.
    },
  };
}

// Source-authored seconds, independent of frameMs and display labels.
export function createCanonicalEmbedClock({ clock, frameTimesSeconds, render }, emit) {
  if (!Array.isArray(frameTimesSeconds) || !clock || typeof clock.state !== 'function') return null;
  const times = frameTimesSeconds.map(t => t * 1000);
  if (!times.length || times.some((t, i) => !Number.isFinite(t) || t < 0 || (i && t <= times[i - 1]))) return null;
  const step = times.length > 1 ? times[1] - times[0] : null;
  const info = { frames: times.length, frameTimes: times,
    timeRange: { start: times[0], end: times.at(-1),
      ...(step && times.every((t, i) => i === 0 || t - times[i - 1] === step) ? { step } : {}) } };
  let previous = clock.state().frameIndex;
  const observe = () => {
    const next = clock.state().frameIndex;
    if (next !== previous && Number.isFinite(times[next])) emit(times[next]);
    previous = next;
  };
  return {
    info: () => structuredClone(info), observe,
    setTime(t) {
      if (!Number.isFinite(t)) return;
      observe();
      let index = 0;
      while (index + 1 < times.length && times[index + 1] <= t) index++;
      clock.setPlaying(false);
      render(clock.seek(times[index] / 1000));
      previous = clock.state().frameIndex;
    },
  };
}
