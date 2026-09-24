// Engine-neutral decision for what a loaded GLB's surface appearance comes from.
//
// The viewer restyles loaded geometry so sites share one visual language. That
// is the right default and stays the default here. It is not right for an asset
// whose declared purpose is to carry its own authored appearance: restyling
// discards exactly the thing the asset exists to deliver.
//
// The decision is kept pure and separate from the loader so it can be asserted
// without a browser, a GLB, or site data.

/** The primitive's own declared material is kept. */
export const APPEARANCE_DECLARED = 'declared';
/** An explicit caller-supplied material wins, as before. */
export const APPEARANCE_EXPLICIT = 'explicit';
/** The viewer's shared restyle, unchanged from before this capability. */
export const APPEARANCE_RESTYLE = 'restyle';

/**
 * Resolve where a loaded primitive's appearance comes from.
 *
 * `declaresMaterials` is read from the parsed glTF, not from the three.js
 * material: the loader substitutes a default material for primitives that
 * declare none, so trusting the runtime object would treat "the file said
 * nothing" as "the file said this". A primitive that declares no material is
 * therefore restyled even when preservation is requested, which keeps the
 * declaration from silently changing the shading of vertex-coloured geometry.
 *
 * @param {object} input
 * @param {boolean} [input.hasExplicitMaterial] caller passed a material.
 * @param {boolean} [input.preserveDeclaredAppearance] the data asked to keep it.
 * @param {boolean} [input.declaresMaterials] the glTF primitive references a declared material.
 * @returns {'explicit'|'declared'|'restyle'}
 */
export function resolveAppearanceSource({
  hasExplicitMaterial = false,
  preserveDeclaredAppearance = false,
  declaresMaterials = false,
} = {}) {
  if (hasExplicitMaterial) return APPEARANCE_EXPLICIT;
  if (preserveDeclaredAppearance && declaresMaterials) return APPEARANCE_DECLARED;
  return APPEARANCE_RESTYLE;
}

/**
 * Check the authored assignment for this runtime primitive, not the asset's
 * material table or the loader's substituted default material. GLTFLoader
 * associates each primitive mesh (including reused node clones) with these
 * mesh/primitive indices in its parsed source.
 */
export function gltfPrimitiveDeclaresMaterial(gltf, mesh) {
  const parser = gltf?.parser;
  const association = parser?.associations?.get(mesh);
  const primitive = parser?.json?.meshes?.[association?.meshes]?.primitives?.[association?.primitives];
  const material = primitive?.material;
  return Number.isInteger(material) && material >= 0
    && parser.json.materials?.[material] != null;
}

/**
 * Read the declaration off a site-config prop entry or a manifest-declared
 * layer request. Absent means false; a non-boolean is a declaration error
 * rather than a truthy value, so a typo cannot quietly enable preservation.
 *
 * @param {object} record prop entry or layer request.
 * @param {string} label used in the error message.
 */
export function readAppearanceDeclaration(record, label) {
  if (!record || !Object.prototype.hasOwnProperty.call(record, 'preserve_declared_appearance')) {
    return false;
  }
  const value = record.preserve_declared_appearance;
  if (typeof value !== 'boolean') {
    throw new Error(
      `appearance policy: preserve_declared_appearance for ${label} must be a boolean`,
    );
  }
  return value;
}
