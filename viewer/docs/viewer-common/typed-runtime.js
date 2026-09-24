export class TypedRuntimeRegistry {
  constructor() {
    this._elementsById = new Map();
    this._elementsBySemanticType = new Map();
    this._terrainPatchesById = new Map();
    this._geometryRowsByElementId = new Map();
    this._geometryReportLoaded = false;
    this._selectedId = null;
    this._highlightedIds = new Set();
    this._renderedObjectAssociations = new Map();
    this._renderedObjectAssociationsByTypedId = new Map();
  }

  async loadArtifacts({ typedSet, terrainReference, geometryReport } = {}) {
    this._indexTypedSet(typedSet);
    this._indexTerrainReference(terrainReference);
    this._indexGeometryReport(geometryReport);
    return this;
  }

  static async loadFromUrls(urls = {}) {
    const [typedSet, terrainReference, geometryReport] = await Promise.all([
      fetchJson(urls.typedSetUrl),
      fetchJson(urls.terrainReferenceUrl),
      fetchJson(urls.geometryReportUrl, { optional: true }),
    ]);
    return new TypedRuntimeRegistry().loadArtifacts({ typedSet, terrainReference, geometryReport });
  }

  getElement(id) {
    return this._elementsById.get(id) || null;
  }

  getElementsBySemanticType(semanticType) {
    return [...(this._elementsBySemanticType.get(semanticType) || [])];
  }

  getLineage(id) {
    return this.getElement(id)?.lineage || null;
  }

  getTerrainPatch(patchId) {
    return this._terrainPatchesById.get(patchId) || null;
  }

  getTerrainPatchForElement(id) {
    const element = this.getElement(id);
    if (!element?.terrain_reference_patch_id) return null;
    return this.getTerrainPatch(element.terrain_reference_patch_id);
  }

  getGeometryReport(id) {
    const row = this._geometryRowsByElementId.get(id);
    if (row) return row;
    if (!this._geometryReportLoaded) {
      return {
        missing: true,
        reason: 'geometry-report-not-loaded',
        set_element_id: id,
      };
    }
    return {
      missing: true,
      reason: 'not-found',
      set_element_id: id,
    };
  }

  selectElement(id) {
    if (!this._elementsById.has(id)) {
      this._selectedId = null;
      return { ok: false, reason: 'not-found', id };
    }
    this._selectedId = id;
    return { ok: true, id };
  }

  getSelectedElement() {
    return this._selectedId ? this.getElement(this._selectedId) : null;
  }

  getSelectedElementWithGeometry() {
    const element = this.getSelectedElement();
    if (!element) return { element: null, geometry: null };
    return {
      element,
      geometry: this.getGeometryReport(element.id),
    };
  }

  clearSelection() {
    this._selectedId = null;
  }

  highlightElement(id) {
    if (!this._elementsById.has(id)) {
      return { ok: false, reason: 'not-found', id };
    }
    this._highlightedIds.add(id);
    return { ok: true, id };
  }

  getHighlightedElementIds() {
    return [...this._highlightedIds];
  }

  clearHighlight(id = null) {
    if (id === null) {
      this._highlightedIds.clear();
      return;
    }
    this._highlightedIds.delete(id);
  }

  associateRenderedObject(objectId, setElementId, metadata = {}) {
    const association = {
      object_id: objectId,
      set_element_id: setElementId,
      ...metadata,
    };
    this._renderedObjectAssociations.set(objectId, association);
    if (!this._renderedObjectAssociationsByTypedId.has(setElementId)) {
      this._renderedObjectAssociationsByTypedId.set(setElementId, []);
    }
    this._renderedObjectAssociationsByTypedId.get(setElementId).push(association);
    return association;
  }

  getRenderedObjectAssociation(objectId) {
    return this._renderedObjectAssociations.get(objectId) || null;
  }

  getRenderedObjectAssociationsByTypedId(setElementId) {
    return [...(this._renderedObjectAssociationsByTypedId.get(setElementId) || [])];
  }

  report() {
    return {
      elements: {
        count: this._elementsById.size,
        ids: [...this._elementsById.keys()],
      },
      terrainPatches: {
        count: this._terrainPatchesById.size,
        ids: [...this._terrainPatchesById.keys()],
      },
      geometryRows: {
        count: this._geometryRowsByElementId.size,
        ids: [...this._geometryRowsByElementId.keys()],
      },
    };
  }

  _indexTypedSet(typedSet) {
    this._elementsById.clear();
    this._elementsBySemanticType.clear();
    for (const element of typedSet?.elements || []) {
      // Generic Edge records are rendered through the context-layer consumer.
      // They are deliberately absent from typed selection, topology, terrain,
      // and runtime-authority indexes.
      if (element.authority_scope === 'context-only') continue;
      this._elementsById.set(element.id, element);
      if (!this._elementsBySemanticType.has(element.semantic_type)) {
        this._elementsBySemanticType.set(element.semantic_type, []);
      }
      this._elementsBySemanticType.get(element.semantic_type).push(element);
    }
  }

  _indexTerrainReference(terrainReference) {
    this._terrainPatchesById.clear();
    for (const patch of terrainReference?.patches || []) {
      this._terrainPatchesById.set(patch.patch_id, patch);
    }
  }

  _indexGeometryReport(geometryReport) {
    this._geometryRowsByElementId.clear();
    this._geometryReportLoaded = Boolean(geometryReport);
    for (const row of geometryReport?.rows || geometryReport?.elements || []) {
      this._geometryRowsByElementId.set(row.set_element_id, row);
    }
  }
}

async function fetchJson(url, { optional = false } = {}) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) {
    if (optional && response.status === 404) return null;
    throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
  }
  return response.json();
}
