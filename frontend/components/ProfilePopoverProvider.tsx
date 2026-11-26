'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ProfilePopover, type ProfileTarget } from './ProfilePopover';

type ProfilePopoverContextValue = {
  openProfile: (userId: string, anchor: HTMLElement) => void;
  openEditProfile: () => void;
};

const ProfilePopoverContext = createContext<ProfilePopoverContextValue | undefined>(undefined);

export function ProfilePopoverProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [target, setTarget] = useState<ProfileTarget | null>(null);

  const openProfile = useCallback((userId: string, anchor: HTMLElement) => setTarget({ userId, anchor }), []);

  const openEditProfile = useCallback(() => {
    setTarget(null);
    router.push('/channels/@me/settings?tab=profile');
  }, [router]);

  return (
    <ProfilePopoverContext.Provider value={{ openProfile, openEditProfile }}>
      {children}
      <ProfilePopover target={target} onClose={() => setTarget(null)} onEditProfile={openEditProfile} />
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
