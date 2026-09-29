/** Camera behavior shared by the single-flight and daily snapshot adapters. */
export class FollowCamera {
  constructor(api) { this.api = api; this.reset(); }
  reset() { this.followPosition = null; this.tailHeading = null; }
  sync(position, headingRad, delta = 0, mode = 'center', framing = {}) {
    const {api} = this;
    if (mode === 'tail') {
      // Preserve the original drone view; larger vehicles can keep their body
      // beyond the viewer's near clipping plane with a wider framing.
      const {behind = 12, above = 4, ahead = 2} = framing;
      if (this.tailHeading === null) this.tailHeading = headingRad;
      const turn = Math.atan2(Math.sin(headingRad - this.tailHeading), Math.cos(headingRad - this.tailHeading));
      const dt = Math.max(0, delta), filteredTurn = turn * (1 - Math.exp(-dt / 800));
      const maxTurn = 70 * Math.PI / 180 * dt / 1000;
      this.tailHeading += Math.max(-maxTurn, Math.min(maxTurn, filteredTurn));
      const dx = Math.sin(this.tailHeading), dy = Math.cos(this.tailHeading);
      if (api.setCameraPose?.([position.x - behind * dx, position.y - behind * dy, position.z + above],
        [position.x + ahead * dx, position.y + ahead * dy, position.z]) !== true) {
        throw new Error('Viewer tail camera pose is unavailable or outside camera limits');
      }
    } else {
      if (!this.followPosition) {
        // Center once using the public view ray, preserving zoom and orbit angle.
        const direction = api.camera.getWorldDirection(new api.THREE.Vector3());
        const distance = (position.z - api.camera.position.z) / direction.z;
        this.followPosition = Number.isFinite(distance) && distance > 0
          ? api.camera.position.clone().addScaledVector(direction, distance) : position.clone();
      }
      const movement = position.clone().sub(this.followPosition);
      if (api.translateCameraTarget?.(movement.x, movement.y, movement.z) !== true) {
        throw new Error('Viewer camera translation is unavailable');
      }
      this.followPosition = position.clone();
    }
    api.camera.updateMatrixWorld();
  }
}
