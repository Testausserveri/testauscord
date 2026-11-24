'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ProfilePopover, type ProfileTarget } from './ProfilePopover';

type ProfilePopoverContextValue = {
  openProfile: (userId: string, anchor: HTMLElement) => void;
};

const ProfilePopoverContext = createContext<ProfilePopoverContextValue | undefined>(undefined);

export function ProfilePopoverProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ProfileTarget | null>(null);
  const openProfile = useCallback((userId: string, anchor: HTMLElement) => setTarget({ userId, anchor }), []);

  return (
    <ProfilePopoverContext.Provider value={{ openProfile }}>
      {children}
      <ProfilePopover target={target} onClose={() => setTarget(null)} />
    </ProfilePopoverContext.Provider>
  );
}

export const useProfilePopover = (): ProfilePopoverContextValue => {
  const context = useContext(ProfilePopoverContext);
  if (!context) {
    throw new Error('useProfilePopover must be used within a ProfilePopoverProvider');
  }
  return context;
};
