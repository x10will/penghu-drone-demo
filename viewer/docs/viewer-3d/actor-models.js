// viewer-story-cinema: toy low-poly bicycle geometry for cycling cohorts.
// A single merged BufferGeometry (not a Group) so the mesh keeps carrying
// ONE userData object per actor — routeHitToInspector reads
// hit.object.userData.cohortId, and a Group would put userData on children,
// not the raycast-hit object.
//
// Unit-oriented to face +X (the project's heading convention: a cohort
// actor's rotation.z = headingRad turns +X into the travel direction).
// Dimensions are in world units, same footing as the sphere actor's radius-1
// base shape (main.js applies the same crowd-size scale multiplier on top).
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEEL_RADIUS = 1.6;
const WHEEL_WIDTH = 0.5;
const HALF_WHEELBASE = 2.4;   // wheelbase 4.8 + 2×radius ⇒ ~8 m overall length
const BAR_THICK = 0.4;
const TOP_HEIGHT = 5.0;       // saddle/handlebar height ⇒ ~5 m overall height
const SEAT_X = -1.0;          // seat post sits back toward the rear wheel

/** Toy low-poly bicycle: 2 wheels, frame bar, seat post + saddle, front
 *  fork + handlebar (7 primitives) merged into one BufferGeometry. */
export function buildBikeGeometry(THREE) {
  const parts = [];

  const wheel = (x) => {
    const g = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 8);
    g.translate(x, 0, WHEEL_RADIUS);
    return g;
  };
  parts.push(wheel(-HALF_WHEELBASE), wheel(HALF_WHEELBASE));

  const frameBar = new THREE.BoxGeometry(HALF_WHEELBASE * 2, BAR_THICK, BAR_THICK);
  frameBar.translate(0, 0, WHEEL_RADIUS);
  parts.push(frameBar);

  const seatPostHeight = TOP_HEIGHT - WHEEL_RADIUS;
  const seatPost = new THREE.BoxGeometry(BAR_THICK, BAR_THICK, seatPostHeight);
  seatPost.translate(SEAT_X, 0, WHEEL_RADIUS + seatPostHeight / 2);
  parts.push(seatPost);

  const saddle = new THREE.BoxGeometry(1.2, 0.6, 0.3);
  saddle.translate(SEAT_X, 0, TOP_HEIGHT);
  parts.push(saddle);

  const forkHeight = TOP_HEIGHT - WHEEL_RADIUS;
  const fork = new THREE.BoxGeometry(BAR_THICK, BAR_THICK, forkHeight);
  fork.translate(HALF_WHEELBASE, 0, WHEEL_RADIUS + forkHeight / 2);
  parts.push(fork);

  const handlebar = new THREE.BoxGeometry(0.3, 1.6, 0.3);
  handlebar.translate(HALF_WHEELBASE, 0, TOP_HEIGHT);
  parts.push(handlebar);

  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}
