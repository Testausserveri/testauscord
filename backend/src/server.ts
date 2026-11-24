import { websocket } from '@hono/bun';
import app from './index';
import { getSession } from './auth/session';
import { startHeartbeat, startSessionRevalidation } from './realtime/connections';
import { startDispatcher } from './realtime/dispatcher';
import { MAX_BUFFERED_BYTES, MAX_FRAME_BYTES } from './realtime/protocol';

const port = Number(Bun.env.PORT) || 3000;
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const server = Bun.serve({
  port,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
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
startSessionRevalidation(getSession);

console.log(`API listening on ${server.url}`);
