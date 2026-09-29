/**
 * FrameStreamLoader — progressive frame loading for CesiumJS viewer.
 *
 * Loads metadata envelope first, then streams frame chunks sequentially.
 * Supports priority fetch when user scrubs to an unloaded frame.
 */

const FALLBACK_MONOLITHIC = true;

export class FrameStreamLoader {
  constructor(baseUrl) {
    this.baseUrl = baseUrl; // e.g. '../../data/sml/frames_v5_a_viewer'
    this.meta = null;
    this.frames = [];
    this.loadedChunks = new Set();
    this.totalChunks = 0;
    this._abortController = null;
    this._sequentialQueue = [];
    this._sequentialRunning = false;
    this._onChunkLoaded = null;
    this._onPlaybackReady = null;
    this._usedFallback = false;
  }

  get frameCount() {
    return this.meta ? this.meta.frame_count : 0;
  }

  get chunksLoaded() {
    return this.loadedChunks.size;
  }

  isLoaded(frameIdx) {
    if (this._usedFallback) return frameIdx < this.frames.length;
    if (!this.meta) return false;
    const chunkIdx = this._chunkIndexForFrame(frameIdx);
    return this.loadedChunks.has(chunkIdx);
  }

  getFrame(frameIdx) {
    if (frameIdx < 0 || frameIdx >= this.frames.length) return null;
    return this.frames[frameIdx] || null;
  }

  onChunkLoaded(cb) { this._onChunkLoaded = cb; }
  onPlaybackReady(cb) { this._onPlaybackReady = cb; }

  async load() {
    try {
      this.meta = await this._fetchJSON(`${this.baseUrl}_meta.json`);
    } catch {
      if (FALLBACK_MONOLITHIC) {
        return this._loadMonolithic();
      }
      throw new Error('Metadata envelope not found and fallback disabled');
    }

    this.totalChunks = this.meta.chunks.length;
    this.frames = new Array(this.meta.frame_count);

    // Fetch chunk 0 first — enables playback
    await this._fetchChunk(0);
    if (this._onPlaybackReady) this._onPlaybackReady();

    // Queue remaining chunks for sequential background fetch
    for (let i = 1; i < this.totalChunks; i++) {
      this._sequentialQueue.push(i);
    }
    this._runSequentialQueue();

    return this.meta;
  }

  async fetchChunkForFrame(frameIdx) {
    const chunkIdx = this._chunkIndexForFrame(frameIdx);
    if (this.loadedChunks.has(chunkIdx)) return;

    // Abort current sequential fetch to prioritize this one
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    await this._fetchChunk(chunkIdx);

    // Remove from sequential queue if present, then resume
    this._sequentialQueue = this._sequentialQueue.filter(i => i !== chunkIdx);
    if (!this._sequentialRunning) this._runSequentialQueue();
  }

  _chunkIndexForFrame(frameIdx) {
    if (!this.meta) return -1;
    for (let i = 0; i < this.meta.chunks.length; i++) {
      const c = this.meta.chunks[i];
      if (frameIdx >= c.start_frame && frameIdx <= c.end_frame) return i;
    }
    return -1;
  }

  async _fetchChunk(chunkIdx) {
    if (chunkIdx < 0 || chunkIdx >= this.totalChunks) return;
    if (this.loadedChunks.has(chunkIdx)) return;

    const chunkInfo = this.meta.chunks[chunkIdx];
    const url = `${this._baseDir()}/${chunkInfo.file}`;
    const chunkFrames = await this._fetchJSON(url);

    for (let i = 0; i < chunkFrames.length; i++) {
      this.frames[chunkInfo.start_frame + i] = chunkFrames[i];
    }
    this.loadedChunks.add(chunkIdx);

    if (this._onChunkLoaded) {
      this._onChunkLoaded(chunkIdx, this.loadedChunks.size, this.totalChunks);
    }
  }

  async _runSequentialQueue() {
    if (this._sequentialRunning) return;
    this._sequentialRunning = true;

    while (this._sequentialQueue.length > 0) {
      const nextIdx = this._sequentialQueue[0];
      if (this.loadedChunks.has(nextIdx)) {
        this._sequentialQueue.shift();
        continue;
      }

      this._abortController = new AbortController();
      try {
        const chunkInfo = this.meta.chunks[nextIdx];
        const url = `${this._baseDir()}/${chunkInfo.file}`;
        const resp = await fetch(url, { signal: this._abortController.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const chunkFrames = await resp.json();

        for (let i = 0; i < chunkFrames.length; i++) {
          this.frames[chunkInfo.start_frame + i] = chunkFrames[i];
        }
        this.loadedChunks.add(nextIdx);
        this._sequentialQueue.shift();

        if (this._onChunkLoaded) {
          this._onChunkLoaded(nextIdx, this.loadedChunks.size, this.totalChunks);
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          // Priority fetch interrupted us — exit loop, will be restarted
          break;
        }
        console.warn(`Chunk ${nextIdx} fetch failed:`, err.message);
        this._sequentialQueue.shift();
      }
    }

    this._sequentialRunning = false;
    this._abortController = null;
  }

  async _loadMonolithic() {
    const data = await this._fetchJSON(`${this.baseUrl}.json`);
    this._usedFallback = true;
    this.meta = { ...data };
    delete this.meta.frames;
    this.meta.chunks = [];
    this.totalChunks = 0;
    this.frames = data.frames;
    if (this._onPlaybackReady) this._onPlaybackReady();
    return this.meta;
  }

  _baseDir() {
    const parts = this.baseUrl.split('/');
    parts.pop();
    return parts.join('/');
  }

  async _fetchJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    return resp.json();
  }
}
