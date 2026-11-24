import { queryClient } from './queryClient';

export type LogoutReason = 'logout' | 'password' | 'revoked' | 'expired';

type LogoutToast = {
  message: string;
  type: 'success' | 'info';
  priority: number;
};

const STORAGE_KEY = 'logout-toast';

const LOGOUT_TOASTS: Record<LogoutReason, LogoutToast> = {
  logout: { message: 'Successfully logged out', type: 'success', priority: 3 },
  password: { message: 'Password changed. Please log in again', type: 'success', priority: 3 },
  revoked: { message: 'You have been signed out. Please log in again', type: 'info', priority: 2 },
  expired: { message: 'Your session expired. Please log in again', type: 'info', priority: 1 },
};

const readToast = (): LogoutToast | null => {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    return JSON.parse(stored) as LogoutToast;
  } catch {
    return null;
  }
};

export const logoutToLogin = (reason: LogoutReason) => {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;

  const next = LOGOUT_TOASTS[reason];
  const current = readToast();

  queryClient.clear();

  if (!current || next.priority >= current.priority) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable
    }
  }

  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/login');
};

export const takeLogoutToast = (): Omit<LogoutToast, 'priority'> | null => {
  const toast = readToast();

  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable
  }

  return toast ? { message: toast.message, type: toast.type } : null;
};
