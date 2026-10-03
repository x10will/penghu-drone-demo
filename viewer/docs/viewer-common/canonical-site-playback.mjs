// Optional canonical site boundary. Authority: September 13 adapter brief,
// generalized to declared sites by the owner's September 30, 2026 brief.
export function canonicalCandidateUrl(site, search, pageUrl) {
  return canonicalCandidate(site, search, pageUrl)?.url ?? null;
}

// Declared canonical scenarios. `?scenario=<id>` picks one entry of the site's
// `canonicalScenarios` allowlist; without the parameter the site's
// `canonicalManifest` plays as before. An id the site does not declare, or a
// scenario outside the canonical opt-in, fails closed: each scenario plays only
// its own declared candidate, and the viewer never substitutes another one.
export const SCENARIO_AUTHORITY = "Will, 2026-09-28: 'hmm. the use cases are not clear. 巡田 is a feature, identify pest spread is another'";

export function canonicalCandidate(site, search, pageUrl) {
  const query = new URLSearchParams(search);
  const optedIn = query.get('site') === site.id && query.get('canonical') === '1';
  const scenario = query.get('scenario');
  if (scenario === null) {
    return optedIn && site.canonicalManifest
      ? { url: new URL(site.canonicalManifest, pageUrl).href, scenario: null } : null;
  }
  const declared = site.canonicalScenarios && typeof site.canonicalScenarios === 'object'
    ? site.canonicalScenarios : {};
  if (!optedIn || !Object.hasOwn(declared, scenario) || typeof declared[scenario] !== 'string') {
    const known = Object.keys(declared).join(', ') || 'none';
    throw new Error(`情境「${scenario}」未在此站台宣告（已宣告：${known}）。`
      + '為確保每個情境只播放自己宣告的模擬候選資料、不以其他候選代替，檢視器停止載入。'
      + ` Undeclared scenario '${scenario}' (declared: ${known}): refusing to play another candidate in its place.`
      + ` Asked by ${SCENARIO_AUTHORITY}.`);
  }
  return { url: new URL(declared[scenario], pageUrl).href, scenario };
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function localArtifactUrl(path, baseUrl) {
  const base = new URL(baseUrl);
  const url = new URL(path, base);
  if (typeof path !== 'string' || !path || url.origin !== base.origin
      || !url.pathname.startsWith(base.pathname) || url.search || url.hash) {
    throw new Error(`Canonical candidate requires a local declared artifact: ${path}`);
  }
  return url.href;
}

export async function loadCanonicalAdapter({ manifestUrl, staticManifestBytes,
  fetchResource = fetch, importModule = url => import(url) }) {
  const response = await fetchResource(manifestUrl);
  if (!response.ok) throw new Error(`Canonical candidate manifest unavailable: ${manifestUrl}`);
  const manifest = await response.json();
  const resourceBaseUrl = new URL('.', manifestUrl).href;
  if (staticManifestBytes.byteLength !== manifest.static_package_manifest?.byte_count
      || await sha256(staticManifestBytes) !== manifest.static_package_manifest?.sha256) {
    throw new Error('Canonical candidate static manifest binding mismatch (September 13 shared-viewer brief)');
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Canonical candidate has no file receipts');
  const artifacts = Object.create(null);
  for (const receipt of manifest.files) {
    if (Object.hasOwn(artifacts, receipt.path)) throw new Error(`Duplicate candidate artifact: ${receipt.path}`);
    const url = localArtifactUrl(receipt.path, resourceBaseUrl);
    const file = await fetchResource(url);
    if (!file.ok) throw new Error(`Canonical candidate artifact unavailable: ${receipt.path}`);
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== receipt.byte_count || await sha256(bytes) !== receipt.sha256) {
      throw new Error(`Canonical candidate receipt mismatch: ${receipt.path} (September 13 shared-viewer brief)`);
    }
    const text = new TextDecoder().decode(bytes);
    artifacts[receipt.path] = receipt.path.endsWith('.json') ? JSON.parse(text) : text;
  }
  if (!Object.hasOwn(artifacts, manifest.adapter_entry)) throw new Error('Canonical adapter entry has no retained artifact receipt');
  const module = await importModule(localArtifactUrl(manifest.adapter_entry, resourceBaseUrl));
  const adapter = await module.createAdapter({ manifest, artifacts, resourceBaseUrl });
  // Validate timing before exposing any projection to the shared viewer.
  createCanonicalClock(adapter);
  return adapter;
}

// Farm presentation tokens. The adapter hands one token per governed Face per
// frame as `presentation[propId]` (Farm Director ruling 2026-09-17, carried by
// the candidate as crop-health-presentation.json). The viewer paints exactly
// what a token says and restores the baked look for every registered prop the
// frame leaves alone; it never derives a colour, a level, or a token itself.
// A candidate without the field paints nothing, so older candidates render as
// before.
export function presentationPaint(presentation, propIds) {
  const paint = {};
  for (const propId of propIds) {
    const token = presentation && typeof presentation === 'object' && Object.hasOwn(presentation, propId)
      ? presentation[propId] : null;
    if (token === null) { paint[propId] = { fill: false }; continue; }
    if (token?.overrides_baked_appearance === true) {
      if (typeof token.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(token.color)) {
        throw new Error(`Canonical presentation token overrides without a declared colour: ${propId}`);
      }
      paint[propId] = { fill: true, color: token.color };
    } else if (token?.overrides_baked_appearance === false) {
      paint[propId] = { fill: false };
    } else {
      throw new Error(`Canonical presentation token must declare overrides_baked_appearance: ${propId}`);
    }
  }
  return paint;
}

export function createCanonicalClock({ durationSeconds, frameTimesSeconds }) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0
      || !Array.isArray(frameTimesSeconds) || frameTimesSeconds[0] !== 0
      || frameTimesSeconds.some((t, i) => !Number.isFinite(t) || t < 0 || t > durationSeconds
        || (i > 0 && t <= frameTimesSeconds[i - 1]))) throw new Error('Invalid supplied canonical timeline');
  let elapsedSeconds = 0, playing = false, speed = 1, baseline = null;
  const index = () => {
    let i = 0;
    while (i + 1 < frameTimesSeconds.length && frameTimesSeconds[i + 1] <= elapsedSeconds) i++;
    return i;
  };
  const state = () => ({ elapsedSeconds, frameIndex: index(), playing, speed });
  return {
    state,
    setPlaying(value) { playing = Boolean(value) && elapsedSeconds < durationSeconds; baseline = null; return state(); },
    setSpeed(value) { if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid playback speed'); speed = value; baseline = null; return state(); },
    seek(value) { elapsedSeconds = Math.max(0, Math.min(durationSeconds, value)); baseline = null; if (elapsedSeconds === durationSeconds) playing = false; return state(); },
    step(delta) { return this.seek(frameTimesSeconds[Math.max(0, Math.min(frameTimesSeconds.length - 1, index() + delta))]); },
    reset() { elapsedSeconds = 0; playing = false; baseline = null; return state(); },
    tick(now) {
      if (!playing) { baseline = null; return state(); }
      if (baseline !== null) elapsedSeconds = Math.min(durationSeconds, elapsedSeconds + Math.max(0, now - baseline) / 1000 * speed);
      baseline = now;
      if (elapsedSeconds === durationSeconds) { playing = false; baseline = null; }
      return state();
    },
  };
}
