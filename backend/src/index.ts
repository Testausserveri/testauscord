import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { csrf } from 'hono/csrf';
import { except } from 'hono/combine';
import auth from './middleware/auth';
import signup from './routes/signup';
import login from './routes/login';
import users from './routes/users';
import logout from './routes/logout';

const app = new Hono();

app.use(except('/logout', csrf()));
app.use(secureHeaders());
app.use(auth);

app.route('/', signup);
app.route('/', login);
app.route('/', users);
app.route('/', logout);

export default {
  port: Bun.env.PORT || 3000,
  fetch: app.fetch,
};
