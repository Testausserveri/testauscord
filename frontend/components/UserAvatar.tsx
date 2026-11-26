'use client';

import { useState } from 'react';
import { avatarUrl } from '@/api/api';
import { useAnimateAvatars, useHoverAnimation, useReducedMotion } from '@/lib/avatarAnimation';
import type { UserRef } from '@/types/types';
import { Avatar, AvatarFallback } from './ui/avatar';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function UserAvatar({ user, className, src, alwaysAnimate = false }: { user: UserRef; className?: string; src?: string; alwaysAnimate?: boolean }) {
  const { rootRef, active } = useHoverAnimation<HTMLDivElement>(alwaysAnimate);
  const animateAvatars = useAnimateAvatars();
  const reducedMotion = useReducedMotion();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const imageSrc = src ?? (user.avatarVersion != null ? avatarUrl(user.id, user.avatarVersion, { static: !active || !animateAvatars || reducedMotion }) : undefined);

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
