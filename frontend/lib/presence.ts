import type { EffectivePresence } from '@/types/types';

export type PresenceDisplay = EffectivePresence | 'INVISIBLE';

const LABELS: Record<PresenceDisplay, string> = {
  ONLINE: 'Online',
  IDLE: 'Idle',
  DND: 'Do Not Disturb',
  OFFLINE: 'Offline',
  INVISIBLE: 'Invisible',
};

const DOT_CLASSES: Record<PresenceDisplay, string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-amber-500',
  DND: 'bg-red-500',
  OFFLINE: 'bg-gray-500',
  INVISIBLE: 'border-2 border-muted-foreground bg-background',
};

export const presenceLabel = (status: PresenceDisplay) => LABELS[status];

export const presenceDotClass = (status: PresenceDisplay) => DOT_CLASSES[status];
