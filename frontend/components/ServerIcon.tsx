'use client';

import { useState } from 'react';
import { serverIconUrl } from '@/api/api';
import { useAnimateAvatars, useHoverAnimation, useReducedMotion } from '@/lib/avatarAnimation';
import { cn } from '@/lib/utils';
import type { Server } from '@/types/types';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function ServerIcon({ server, className, src, static: forceStatic = false }: { server: Pick<Server, 'id' | 'name' | 'iconVersion'>; className?: string; src?: string; static?: boolean }) {
  const { rootRef, active } = useHoverAnimation<HTMLSpanElement>();
  const animateAvatars = useAnimateAvatars();
  const reducedMotion = useReducedMotion();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const imageSrc = src ?? (server.iconVersion != null ? serverIconUrl(server.id, server.iconVersion, { static: forceStatic || !active || !animateAvatars || reducedMotion }) : null);

  return (
    <span ref={rootRef} className={cn('flex size-full items-center justify-center overflow-hidden', className)}>
      {imageSrc && failedSrc !== imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc} alt="" className="size-full object-cover" onError={() => setFailedSrc(imageSrc)} />
      ) : (
        initials(server.name)
      )}
    </span>
  );
}
