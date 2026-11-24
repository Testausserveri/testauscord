'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { EditProfileDialog } from './EditProfileDialog';
import { ProfilePopover, type ProfileTarget } from './ProfilePopover';

type ProfilePopoverContextValue = {
  openProfile: (userId: string, anchor: HTMLElement) => void;
  openEditProfile: () => void;
};

const ProfilePopoverContext = createContext<ProfilePopoverContextValue | undefined>(undefined);

export function ProfilePopoverProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ProfileTarget | null>(null);
  const [editing, setEditing] = useState(false);

  const openProfile = useCallback((userId: string, anchor: HTMLElement) => setTarget({ userId, anchor }), []);

  const openEditProfile = useCallback(() => {
    setTarget(null);
    setEditing(true);
  }, []);

  return (
    <ProfilePopoverContext.Provider value={{ openProfile, openEditProfile }}>
      {children}
      <ProfilePopover target={target} onClose={() => setTarget(null)} onEditProfile={openEditProfile} />
      {editing && <EditProfileDialog onClose={() => setEditing(false)} />}
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
