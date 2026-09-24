// Story-narration beat resolution (sml-red-v5 task 5.2). PURE functions —
// NO Three.js, DOM, or fetch (viewer-engine-policy: shared logic lives under
// viewer-common/). The viewer fetches director_narration_<scenario>.json (an
// array of {time:"HH:MM", beat, text, commentary?, metrics?, provenance?})
// and resolves "which beat is the story at, at this frame time": the most
// recent beat whose time <= the frame time, held until the next beat starts —
// scrub-safe in both directions.
//
// Times are zero-padded "HH:MM" so plain string comparison is chronological.

/** Sort/sanitize a narration artifact into a beat list the viewer can index. */
export function buildBeatIndex(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e.time === 'string' && /^\d{2}:\d{2}$/.test(e.time))
    .slice()
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

/** The beat active at frameTime: last beat with time <= frameTime, else null. */
export function currentBeat(beats, frameTime) {
  if (!beats || !beats.length || typeof frameTime !== 'string') return null;
  let active = null;
  for (const b of beats) {
    if (b.time <= frameTime) active = b;
    else break;
  }
  return active;
}

/**
 * The protagonist cohorts carry "wannabe" in their id (v5a_wannabe_ferry…).
 *
 * CONVENTION, not data: this id-sniff bypasses the baked cohort_metadata
 * (which carries meta.color the viewer already reads). A future scenario's
 * protagonist not named "wannabe" gets no highlight until the scriptor
 * marks protagonists in cohort metadata and this routes through it —
 * documented as the follow-up in sml-red-v5 design.md O3½.
 */
export function isWannabeCohort(cohortId) {
  return typeof cohortId === 'string' && /wannabe/i.test(cohortId);
}

/**
 * Protagonist test routed through the story config's declared tracks
 * (viewer-story-cinema D3 — fixes the pre-14:00 hole where the morning
 * ride cohort has a generic id the /wannabe/ sniff can't see). Falls back
 * to the id convention when no config is loaded.
 */
export function isProtagonist(cohortId, storyConfig) {
  const tracks = storyConfig && storyConfig.protagonist_tracks;
  if (Array.isArray(tracks) && tracks.length) {
    return tracks.some((t) => t && t.cohort === cohortId);
  }
  return isWannabeCohort(cohortId);
}

// Protagonist styling — single authority so the viewer and tests agree.
export const WANNABE_COLOR = 0xffb84d; // warm gold: readable against terrain + lake
export const WANNABE_SCALE_BOOST = 1.6;
