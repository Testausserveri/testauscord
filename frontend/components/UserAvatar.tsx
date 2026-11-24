import { avatarUrl } from '@/api/api';
import type { UserRef } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function UserAvatar({ user, className, src }: { user: UserRef; className?: string; src?: string }) {
  const imageSrc = src ?? (user.avatarVersion != null ? avatarUrl(user.id, user.avatarVersion) : undefined);

  return (
    <Avatar className={className}>
      {imageSrc && <AvatarImage src={imageSrc} alt="" />}
      <AvatarFallback className="bg-muted">{initials(user.displayName ?? user.username)}</AvatarFallback>
    </Avatar>
  );
}
