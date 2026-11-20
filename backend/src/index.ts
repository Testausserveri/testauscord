import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { csrf } from 'hono/csrf';
import { cors } from 'hono/cors';
import auth from './middleware/auth';
import signup from './routes/signup';
import login from './routes/login';
import users from './routes/users';
import logout from './routes/logout';
import friends from './routes/friends';
import ws from './routes/ws';
import channels from './routes/channels';
import realtime from './routes/realtime';

const app = new Hono();

app.use(csrf({ origin: Bun.env.FRONTEND_URL || '' }));
app.use(secureHeaders());
app.use(auth);
app.use('/*', cors({ origin: Bun.env.FRONTEND_URL || '', credentials: true }));

app.route('/', signup);
app.route('/', login);
app.route('/', users);
app.route('/', logout);
app.route('/friends', friends);
app.route('/', ws);
app.route('/channels', channels);
app.route('/realtime', realtime);

export default app;
