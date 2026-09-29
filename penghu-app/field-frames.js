import {FrameStreamLoader} from '../frame-stream-loader.js';

// Keep the existing chunk format/loader. Own fetch cancellation and serialize
// priority reads; disable its unowned eager queue so disposal aborts every read.
export class FieldFrames extends FrameStreamLoader {
  constructor(url){super(url);this.abort=new AbortController();this.pending=new Map();}
  async _fetchJSON(url){const response=await fetch(url,{signal:this.abort.signal});if(!response.ok)throw new Error(`Field HTTP ${response.status}`);return response.json();}
  async _runSequentialQueue() {}
  async ensure(i0,i1){
    for(const i of [i0,i1]){
      if(this.isLoaded(i))continue;
      const chunk=this._chunkIndexForFrame(i);
      if(!this.pending.has(chunk))this.pending.set(chunk,this.fetchChunkForFrame(i).finally(()=>this.pending.delete(chunk)));
      await this.pending.get(chunk);
    }
  }
  dispose(){this.abort.abort();this.onChunkLoaded(null);this.onPlaybackReady(null);}
}
