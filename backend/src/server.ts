import { websocket } from '@hono/bun';
import app from './index';
import { startHeartbeat } from './realtime/connections';
import { startDispatcher } from './realtime/dispatcher';
import { MAX_BUFFERED_BYTES, MAX_FRAME_BYTES } from './realtime/protocol';

const port = Number(Bun.env.PORT) || 3000;
const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket: {
    ...websocket,
    maxPayloadLength: MAX_FRAME_BYTES,
    backpressureLimit: MAX_BUFFERED_BYTES,
    closeOnBackpressureLimit: true,
  },
});

startDispatcher();
startHeartbeat();

console.log(`API listening on ${server.url}`);
