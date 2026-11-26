import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'animate-avatars';
const CHANGE_EVENT = 'animate-avatars-change';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

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

const subscribeReducedMotion = (callback: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};

const getReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

export const useReducedMotion = () => useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);

export const useHoverAnimation = <T extends HTMLElement>(alwaysAnimate = false) => {
  const rootRef = useRef<T>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const scope = root.closest('[data-avatar-hover]') ?? root;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);

    scope.addEventListener('pointerenter', enter);
    scope.addEventListener('pointerleave', leave);

    return () => {
      scope.removeEventListener('pointerenter', enter);
      scope.removeEventListener('pointerleave', leave);
    };
  }, []);

  return { rootRef, active: alwaysAnimate || hovered };
};
