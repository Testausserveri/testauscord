'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { avatarUrl } from '@/api/api';
import { useAnimateAvatars } from '@/lib/avatarAnimation';
import type { UserRef } from '@/types/types';
import { Avatar, AvatarFallback } from './ui/avatar';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const subscribeReducedMotion = (callback: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};

const getReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function UserAvatar({ user, className, src, alwaysAnimate = false }: { user: UserRef; className?: string; src?: string; alwaysAnimate?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const animateAvatars = useAnimateAvatars();
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

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

  const playing = alwaysAnimate || hovered;
  const imageSrc = src ?? (user.avatarVersion != null ? avatarUrl(user.id, user.avatarVersion, { static: !playing || !animateAvatars || reducedMotion }) : undefined);

  return (
    <Avatar ref={rootRef} className={className}>
      {imageSrc && failedSrc !== imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc} alt="" className="aspect-square size-full" onError={() => setFailedSrc(imageSrc)} />
      ) : (
        <AvatarFallback className="bg-muted">{initials(user.displayName ?? user.username)}</AvatarFallback>
      )}
    </Avatar>
  );
}
