export const isAllowedOrigin = (origin: string | undefined, allowedOrigin = Bun.env.FRONTEND_URL): boolean => {
  if (origin === undefined) return true;
  return Boolean(allowedOrigin) && origin === allowedOrigin;
};
