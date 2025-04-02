export const createSessionTokenCookie = (token: string, expiresAt: Date): string => {
  return `session=${token}; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}; Path=/; ${Bun.env.NODE_ENV === 'production' ? 'Secure;' : ''}`;
};

export const deleteSessionTokenCookie = (): string => {
  return `session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/; ${Bun.env.NODE_ENV === 'production' ? 'Secure;' : ''}`;
};
