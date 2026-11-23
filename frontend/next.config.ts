import type { NextConfig } from 'next';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

const apiOrigins = (() => {
  if (!apiUrl) return { http: [] as string[], ws: [] as string[] };
  try {
    const url = new URL(apiUrl);
    return {
      http: [url.origin],
      ws: [`${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`],
    };
  } catch {
    return { http: [] as string[], ws: [] as string[] };
  }
})();

const isDev = process.env.NODE_ENV === 'development';

const connectSrc = ["'self'", ...apiOrigins.http, ...apiOrigins.ws, ...(isDev ? ['ws:', 'wss:'] : [])].join(' ');
const imgSrc = ["'self'", 'data:', 'blob:', ...apiOrigins.http].join(' ');

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src ${imgSrc}`,
  "font-src 'self'",
  `connect-src ${connectSrc}`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
