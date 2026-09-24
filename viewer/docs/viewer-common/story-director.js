// Story-config resolution (viewer-story-cinema §3). PURE functions — NO
// Three.js, DOM, or fetch. A Director-owned story config
// (data/<site>/story_<scenario>.json) declares HOW to present baked data:
// which cohorts form the protagonist's track through the day, what the
// camera does at each narration beat, and how playback is paced. Configs
// may only REFERENCE baked artifacts — cohort ids / beat slugs / node ids
// are cross-checked against the frames by tests/test_story_config_lineage.py;
// this module validates SHAPE and resolves lookups.
//
// Times are zero-padded "HH:MM" (same convention as story-narration.js),
// so plain string comparison is chronological.

const TIME_RE = /^\d{2}:\d{2}$/;
const CAMERA_MODES = new Set(['follow', 'pose']);

/**
 * The protagonist cohort active at a sim time, from ordered tracks
 * [{cohort, from, to}] — from-inclusive, to-exclusive, `to: null` = open
 * tail. Null when no track covers the time (protagonist not yet spawned).
 */
export function activeTrackCohort(tracks, time) {
  if (!Array.isArray(tracks) || typeof time !== 'string') return null;
  for (const t of tracks) {
    if (!t || typeof t.cohort !== 'string') continue;
    if (time >= t.from && (t.to == null || time < t.to)) return t.cohort;
  }
  return null;
}

/** The story-config beat entry for a narration beat slug, or null. */
export function beatPlan(config, slug) {
  return (config && config.beats && config.beats[slug]) || null;
}

/** Pacing for a beat: beat entry over config defaults. Always fully shaped. */
export function paceForBeat(config, slug) {
  const defaults = (config && config.defaults) || {};
  const beat = beatPlan(config, slug) || {};
  return {
    play_speed_ms: beat.play_speed_ms ?? defaults.play_speed_ms ?? 100,
    skip_to: beat.skip_to ?? null,
    hold_ms: beat.hold_ms ?? 0,
  };
}

// Per-section rules, shared by the strict validator (repo gate) and the
// salvaging loader (runtime). Tracks are validated as a WHOLE section: the
// stitch is order/coverage-dependent, so a partial track list could silently
// follow the wrong cohort — all-or-nothing there is deliberate.
function trackErrors(tracks) {
  const errors = [];
  // A malformed entry (null, string, …) must be an ERROR, not a throw: the
  // runtime salvager wraps this in no try/catch of its own, and a throw here
  // used to discard the whole config silently (#57 review finding 4).
  for (const t of tracks) {
    if (!t || typeof t !== 'object') { errors.push(`track entry ${JSON.stringify(t)} is not an object`); continue; }
    if (!t.cohort) errors.push('track missing cohort');
    if (!TIME_RE.test(t.from || '')) errors.push(`track ${t.cohort}: from ${t.from} not HH:MM`);
    if (t.to != null && !TIME_RE.test(t.to)) errors.push(`track ${t.cohort}: to ${t.to} not HH:MM`);
  }
  for (let i = 0; i + 1 < tracks.length; i++) {
    const a = tracks[i], b = tracks[i + 1];
    if (!a || typeof a !== 'object' || !b || typeof b !== 'object') continue;
    if (a.to == null || (b.from && a.to > b.from)) {
      errors.push(`tracks ${a.cohort}/${b.cohort} overlap (${a.to ?? 'open'} > ${b.from})`);
    }
  }
  return errors;
}

function beatErrors(slug, beat) {
  const errors = [];
  const cam = beat.camera;
  if (cam && !CAMERA_MODES.has(cam.mode)) {
    errors.push(`beat ${slug}: unknown camera mode '${cam.mode}'`);
  }
  if (cam && cam.mode === 'pose' && !cam.pose) errors.push(`beat ${slug}: pose camera without pose`);
  if (beat.skip_to != null && !TIME_RE.test(beat.skip_to)) {
    errors.push(`beat ${slug}: skip_to ${beat.skip_to} not HH:MM`);
  }
  return errors;
}

function figureErrors(fig) {
  return fig.source ? []
    : [`closing_card '${fig.label}': missing source (every figure names its artifact)`];
}

function displayErrors(display) {
  return (display && display.min_cohort_pax != null && !display.reason)
    ? ['display.min_cohort_pax without a cited reason'] : [];
}

/**
 * Shape validation. Returns a list of human-readable errors ([] = valid).
 * Lineage (do the referenced cohorts/beats/nodes EXIST in the bake) is the
 * pytest gate's job — this catches malformed configs before they ship.
 * Strict: ANY error means the config must not ship (repo gate semantics).
 */
export function validateStoryConfig(config) {
  if (!config || typeof config !== 'object') return ['config is not an object'];
  const errors = [...trackErrors(config.protagonist_tracks || [])];
  for (const [slug, beat] of Object.entries(config.beats || {})) {
    errors.push(...beatErrors(slug, beat));
  }
  for (const fig of config.closing_card || []) errors.push(...figureErrors(fig));
  errors.push(...displayErrors(config.display));
  return errors;
}

/**
 * Section-granular salvage for the RUNTIME loader: a bad beat drops THAT
 * beat, an unsourced figure drops THAT figure, a bad track list drops the
 * tracks section — each loudly, without discarding the sections that are
 * fine. Prevents one typo in a beat from silently reverting the protagonist
 * to the /wannabe/ id-sniff (the exact failure D3 exists to prevent).
 * Returns { config, errors }: `config` is the usable subset (null only when
 * the input isn't an object), `errors` names everything dropped.
 */
export function sanitizeStoryConfig(config) {
  if (!config || typeof config !== 'object') {
    return { config: null, errors: ['config is not an object'] };
  }
  const errors = [];
  const kept = { ...config };

  const tErrs = trackErrors(config.protagonist_tracks || []);
  if (tErrs.length) {
    errors.push(...tErrs.map((e) => `${e} — protagonist_tracks section dropped`));
    delete kept.protagonist_tracks;
  }

  if (config.beats) {
    kept.beats = {};
    for (const [slug, beat] of Object.entries(config.beats)) {
      const bErrs = beatErrors(slug, beat);
      if (bErrs.length) errors.push(...bErrs.map((e) => `${e} — beat dropped`));
      else kept.beats[slug] = beat;
    }
  }

  if (config.closing_card) {
    kept.closing_card = config.closing_card.filter((fig) => {
      const fErrs = figureErrors(fig);
      errors.push(...fErrs.map((e) => `${e} — figure dropped`));
      return fErrs.length === 0;
    });
  }

  const dErrs = displayErrors(config.display);
  if (dErrs.length) {
    errors.push(...dErrs.map((e) => `${e} — display section dropped`));
    delete kept.display;
  }
  return { config: kept, errors };
}

/**
 * The film schedule for one chapter (viewer-story-cinema §4): every narration
 * beat, in chronological order, with its resolved pacing and camera plan.
 * playFilm() walks this list against the sim clock — the beat whose time has
 * arrived fires its pace (play_speed_ms / skip_to / hold_ms) and camera
 * (follow spec or geo-anchored pose). Beats without a config entry still
 * appear (they get default pacing and keep the current camera): the film
 * shows every authored beat, config tunes HOW.
 */
export function filmSchedule(beats, config) {
  return (beats || [])
    .filter((b) => b && TIME_RE.test(b.time || ''))
    .map((b) => {
      const plan = beatPlan(config, b.beat || '');
      return {
        time: b.time,
        slug: b.beat || '',
        pace: paceForBeat(config, b.beat || ''),
        camera: (plan && plan.camera) || null,
      };
    })
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/**
 * ↑/↓ live tempo for cinema mode (multiplier on every beat's authored
 * play_speed_ms). A fixed ladder — not free scaling — so repeated presses
 * land on presenter-friendly stops and ×1 is always reachable again.
 * Off-ladder / missing input snaps to the nearest rung before stepping;
 * steps clamp at the ends.
 */
const TEMPO_LADDER = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function cinemaTempoStep(current, dir) {
  const cur = Number.isFinite(current) ? current : 1;
  let nearest = 0;
  for (let i = 1; i < TEMPO_LADDER.length; i++) {
    if (Math.abs(TEMPO_LADDER[i] - cur) < Math.abs(TEMPO_LADDER[nearest] - cur)) nearest = i;
  }
  const next = nearest + (dir > 0 ? 1 : -1);
  return TEMPO_LADDER[Math.max(0, Math.min(TEMPO_LADDER.length - 1, next))];
}
