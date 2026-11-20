import { websocket } from '@hono/bun';
import app from './index';

const port = Number(Bun.env.PORT) || 3000;
const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket,
});

console.log(`API listening on ${server.url}`);
