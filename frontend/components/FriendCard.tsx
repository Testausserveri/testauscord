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
    <Link href={`/channels/@me/${id}`} className="rounded-lg p-3 flex items-center cursor-pointer hover:bg-[#777777]/15">
      <div className="relative mr-3">
        <Avatar className="h-8 w-8">
          <AvatarImage src={avatar} alt={name} />
          <AvatarFallback className="bg-[#2b2d31]">
            {name.charAt(0)}
            {name.split(' ')[1]?.charAt(0)}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="flex-1">
        <p className="font-semibold">{name}</p>
      </div>
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-[#2b2d31] hover:bg-[#43444b] cursor-pointer">
          <Video className="h-5 w-5 " />
          <span className="sr-only">Video Call</span>
        </Button>
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-[#2b2d31] hover:bg-[#43444b] cursor-pointer">
          <Phone className="h-5 w-5 " />
          <span className="sr-only">Voice Call</span>
        </Button>
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-[#2b2d31] hover:bg-[#43444b] cursor-pointer">
          <MoreHorizontal className="h-5 w-5 " />
          <span className="sr-only">More Options</span>
        </Button>
      </div>
    </Link>
  );
}
