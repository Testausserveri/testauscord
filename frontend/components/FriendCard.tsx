import { MoreHorizontal, Phone, Video } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface FriendCardProps {
  name: string;
  id: string;
  avatar: string;
}

export function FriendCard({ name, id, avatar }: FriendCardProps) {
  return (
    <Link href={`/channels/@me/${id}`} className="rounded-lg p-3 flex items-center hover:bg-accent">
      <div className="relative mr-3">
        <Avatar className="h-8 w-8">
          <AvatarImage src={avatar} alt={name} />
          <AvatarFallback className="bg-muted">
            {name.charAt(0)}
            {name.split(' ')[1]?.charAt(0)}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="flex-1">
        <p className="font-semibold">{name}</p>
      </div>
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-muted hover:bg-accent">
          <Video className="h-5 w-5 " />
          <span className="sr-only">Video Call</span>
        </Button>
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-muted hover:bg-accent">
          <Phone className="h-5 w-5 " />
          <span className="sr-only">Voice Call</span>
        </Button>
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-muted hover:bg-accent">
          <MoreHorizontal className="h-5 w-5 " />
          <span className="sr-only">More Options</span>
        </Button>
      </div>
    </Link>
  );
}
