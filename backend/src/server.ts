import { websocket } from '@hono/bun';
import app, { MAX_REQUEST_BODY_BYTES } from './index';
import { getSession } from './auth/session';
import { setOnLastConnectionRemoved, startHeartbeat, startSessionRevalidation } from './realtime/connections';
import { startDispatcher } from './realtime/dispatcher';
import { MAX_BUFFERED_BYTES, MAX_FRAME_BYTES } from './realtime/protocol';
import { publishPresence } from './services/presence';

const port = Number(Bun.env.PORT) || 3000;
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
setOnLastConnectionRemoved((userId) => void publishPresence(userId).catch(() => {}));

console.log(`API listening on ${server.url}`);
