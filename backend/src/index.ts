import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { cors } from 'hono/cors';
import auth from './middleware/auth';
import { enforceTrustedOrigin } from './middleware/origin';
import signup from './routes/signup';
import login from './routes/login';
import account from './routes/account';
import users from './routes/users';
import logout from './routes/logout';
import friends from './routes/friends';
import dms from './routes/dms';
import ws from './routes/ws';
import channels from './routes/channels';
import realtime from './routes/realtime';
import servers from './routes/servers';

const app = new Hono();

export const MAX_UPLOAD_BODY_BYTES = 1024 * 1024;
export const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DEFAULT_BODY_BYTES = 256 * 1024;

const uploadBodyLimit = bodyLimit({ maxSize: MAX_UPLOAD_BODY_BYTES });
const defaultBodyLimit = bodyLimit({ maxSize: MAX_DEFAULT_BODY_BYTES });
const isUploadRoute = (method: string, path: string) => method === 'PATCH' && (path === '/users/@me' || /^\/servers\/[^/]+$/.test(path));

app.use(enforceTrustedOrigin());
app.use(secureHeaders({ overwrite: false }));
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
app.use('*', (c, next) => (isUploadRoute(c.req.method, c.req.path) ? uploadBodyLimit : defaultBodyLimit)(c, next));
app.use(auth);
app.use('/*', cors({ origin: Bun.env.FRONTEND_URL || '', credentials: true }));

app.route('/', signup);
app.route('/', login);
app.route('/', account);
app.route('/', users);
app.route('/', logout);
app.route('/friends', friends);
app.route('/dms', dms);
app.route('/', ws);
app.route('/channels', channels);
app.route('/realtime', realtime);
app.route('/servers', servers);

export default app;
