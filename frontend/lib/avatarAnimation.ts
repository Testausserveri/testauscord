import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'animate-avatars';
const CHANGE_EVENT = 'animate-avatars-change';

const getSnapshot = () => window.localStorage.getItem(STORAGE_KEY) !== 'false';

const subscribe = (callback: () => void) => {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);

  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
};

export const setAnimateAvatars = (value: boolean) => {
  window.localStorage.setItem(STORAGE_KEY, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const useAnimateAvatars = () => useSyncExternalStore(subscribe, getSnapshot, () => true);
