import {FieldFrames} from './field-frames.js';
import {frameLerp} from './timeline.mjs';
import {cellStyle, sampledGrid} from './field-math.mjs';

const CELL_PX = 8;
const PAINT_MS = 50;

/** Paint the existing simulated danger field at the daily workspace's time. */
export function createDailyHazard(api, {onStatus = () => {}} = {}) {
  const {THREE} = api;
  const loader = new FieldFrames(new URL('../data/danger_frames/danger', import.meta.url).href);
  let disposed = false, failed = false, visible = true, loading = true, error = null;
  let requestedTimeMin = 0, paintedTimeMin = null, frameState = null;
  let meta, mesh, geometry, material, texture, canvas, ctx;
  let timer = null, fetching = false, lastPaintAt = 0;

  function report() {
    if (disposed) return;
    onStatus({visible, loading, timeMin: paintedTimeMin,
      ...(frameState || {}), ...(error ? {error} : {})});
  }

  function releaseResources() {
    mesh?.removeFromParent();
    geometry?.dispose();
    material?.dispose();
    texture?.dispose();
    mesh = geometry = material = texture = canvas = ctx = null;
  }

  function paint(timeMin, pair) {
    const a = loader.getFrame(pair.i0), b = loader.getFrame(pair.i1);
    if (!a || !b) throw new Error('Field frame pair is not ready');
    const [rows, cols] = meta.grid, blocked = new Uint8Array(rows * cols);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let noFlyCells = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const danger = a.danger[r][c] + (b.danger[r][c] - a.danger[r][c]) * pair.frac;
      const margin = a.margin[r][c] + (b.margin[r][c] - a.margin[r][c]) * pair.frac;
      const style = cellStyle(danger, margin, !!meta.land[r][c], meta.danger_clamp, meta.safety_limit);
      const x = c * CELL_PX, y = r * CELL_PX;
      ctx.fillStyle = `rgba(${style.rgba.join(',')})`;
      ctx.fillRect(x, y, CELL_PX, CELL_PX);
      if (style.hatch) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y + CELL_PX); ctx.lineTo(x + CELL_PX, y); ctx.stroke();
      }
      if (style.blocked) { blocked[r * cols + c] = 1; noFlyCells++; }
    }
    // Outline forbidden water as one contour rather than outlining every cell.
    ctx.strokeStyle = 'rgba(255,190,204,0.95)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (blocked[r * cols + c]) {
      const x = c * CELL_PX, y = r * CELL_PX, s = CELL_PX;
      if (r === 0 || !blocked[(r - 1) * cols + c]) { ctx.moveTo(x, y); ctx.lineTo(x + s, y); }
      if (r === rows - 1 || !blocked[(r + 1) * cols + c]) { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y + s); }
      if (c === 0 || !blocked[r * cols + c - 1]) { ctx.moveTo(x, y); ctx.lineTo(x, y + s); }
      if (c === cols - 1 || !blocked[r * cols + c + 1]) { ctx.moveTo(x + s, y); ctx.lineTo(x + s, y + s); }
    }
    ctx.stroke();
    texture.needsUpdate = true;
    paintedTimeMin = timeMin;
    frameState = {...pair, noFlyCells};
    mesh.userData.fieldState = {timeMin, ...frameState};
    mesh.visible = visible;
    lastPaintAt = Date.now();
    loading = false; error = null;
    report();
  }

  function schedule() {
    if (disposed || failed || !visible || !mesh || fetching || timer !== null || requestedTimeMin === paintedTimeMin) return;
    const delay = Math.max(0, PAINT_MS - (Date.now() - lastPaintAt));
    timer = setTimeout(() => { timer = null; void renderLatest(); }, delay);
  }

  async function renderLatest() {
    if (disposed || failed || fetching || !visible || !mesh) return;
    fetching = true;
    try {
      while (!disposed && visible) {
        const pair = frameLerp(meta, requestedTimeMin / 60);
        if (!loader.isLoaded(pair.i0) || !loader.isLoaded(pair.i1)) {
          loading = true; report();
        }
        try {
          await loader.ensure(pair.i0, pair.i1);
        } catch (cause) {
          if (disposed || !visible) return;
          const current = frameLerp(meta, requestedTimeMin / 60);
          // A superseded chunk failure must not strand the current seek.
          if (pair.i0 !== current.i0 || pair.i1 !== current.i1) continue;
          throw cause;
        }
        if (disposed || !visible) return;
        const latest = frameLerp(meta, requestedTimeMin / 60);
        if (pair.i0 !== latest.i0 || pair.i1 !== latest.i1) continue;
        paint(requestedTimeMin, latest);
        return;
      }
    } catch (cause) {
      if (!disposed && cause?.name !== 'AbortError') {
        loading = false; error = cause?.message || String(cause); report();
      }
    } finally {
      fetching = false;
      if (!disposed && !visible && loading) { loading = false; report(); }
      if (!disposed && !error) schedule();
    }
  }

  function setTime(timeMin) {
    if (disposed) return;
    if (!Number.isFinite(timeMin)) {
      error = 'Hazard time must be finite'; report(); return;
    }
    requestedTimeMin = timeMin;
    if (error && !failed) { error = null; report(); }
    schedule();
  }

  function setVisible(nextVisible) {
    if (disposed) return;
    visible = !!nextVisible;
    if (mesh) mesh.visible = visible && paintedTimeMin !== null;
    report();
    if (visible) schedule();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    loader.dispose();
    releaseResources();
  }

  async function initialize() {
    try {
      meta = await loader.load();
      if (disposed) return;
      const grid = sampledGrid(meta.bbox, api.geoToLocal, api.sampleGround, 250);
      if (grid.report.missing) throw new Error('Incomplete terrain sampling coverage');
      const [rows, cols] = meta.grid;
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(grid.uv, 2));
      geometry.setIndex(new THREE.BufferAttribute(grid.indices, 1));
      canvas = document.createElement('canvas'); canvas.width = cols * CELL_PX; canvas.height = rows * CELL_PX;
      ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Hazard canvas is unavailable');
      texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false; texture.colorSpace = THREE.SRGBColorSpace;
      // Canvas row zero is north; CanvasTexture's default flipY maps it to v=1.
      material = new THREE.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false,
        depthTest: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
      mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'penghu-danger-field'; mesh.renderOrder = 3; mesh.raycast = () => {};
      mesh.visible = false; api.scene.add(mesh);
      if (visible) schedule();
      else { loading = false; report(); }
    } catch (cause) {
      if (disposed || cause?.name === 'AbortError') return;
      releaseResources();
      failed = true; loading = false; error = cause?.message || String(cause); report();
    }
  }

  report();
  void initialize();
  return {setTime, setVisible, dispose};
}
