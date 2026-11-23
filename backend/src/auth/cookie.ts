export const SESSION_COOKIE_NAME = '__Host-session';

export const createSessionTokenCookie = (token: string, expiresAt: Date): string => {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Expires=${expiresAt.toUTCString()}; Path=/`;
};

export const deleteSessionTokenCookie = (): string => {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`;
};
