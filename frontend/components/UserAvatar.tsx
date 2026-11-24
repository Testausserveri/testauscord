import type { UserRef } from '@/types/types';
import { Avatar, AvatarFallback } from './ui/avatar';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function UserAvatar({ user, className }: { user: UserRef; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarFallback className="bg-muted">{initials(user.displayName ?? user.username)}</AvatarFallback>
    </Avatar>
  );
}
