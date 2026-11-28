'use client';

import { useState } from 'react';
import { avatarUrl } from '@/api/api';
import { useAnimateAvatars, useHoverAnimation, useReducedMotion } from '@/lib/avatarAnimation';
import { presenceDotClass, presenceLabel, type PresenceDisplay } from '@/lib/presence';
import { cn } from '@/lib/utils';
import type { UserRef } from '@/types/types';
import { Avatar, AvatarFallback } from './ui/avatar';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function UserAvatar({
  user,
  className,
  src,
  alwaysAnimate = false,
  showStatus = false,
  status,
}: {
  user: UserRef;
  className?: string;
  src?: string;
  alwaysAnimate?: boolean;
  showStatus?: boolean;
  status?: PresenceDisplay | null;
}) {
  const { rootRef, active } = useHoverAnimation<HTMLDivElement>(alwaysAnimate);
  const animateAvatars = useAnimateAvatars();
  const reducedMotion = useReducedMotion();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const imageSrc = src ?? (user.avatarVersion != null ? avatarUrl(user.id, user.avatarVersion, { static: !active || !animateAvatars || reducedMotion }) : undefined);

  const avatar = (
    <Avatar ref={rootRef} className={showStatus ? 'size-full' : className}>
      {imageSrc && failedSrc !== imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc} alt="" className="aspect-square size-full" onError={() => setFailedSrc(imageSrc)} />
      ) : (
        <AvatarFallback className="bg-muted">{initials(user.displayName ?? user.username)}</AvatarFallback>
      )}
    </Avatar>
  );

  if (!showStatus) return avatar;

  return (
    <span className={cn('relative inline-flex size-8 shrink-0', className)}>
      {avatar}
      {status && (
        <span
          role="img"
          aria-label={presenceLabel(status)}
          title={presenceLabel(status)}
          className={cn('absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background', presenceDotClass(status))}
        />
      )}
    </span>
  );
}
