import { toEntity } from './embed-selection.js';
import { createMapClient } from './vendor/panel-core/map-client.js';

// The only dependency on the upstream client. No wire envelope is built here.
export function connectProtocol(handlers) {
  const client = createMapClient({ handlers });
  return {
    ready: info => client.ready(info),
    select: pick => client.select(toEntity(pick)),
    time: t => client.time(t),
    appEvent: (name, payload) => client.appEvent(name, payload),
    viewChanged: view => client.viewChanged(view),
    destroy: () => client.destroy(),
  };
}
