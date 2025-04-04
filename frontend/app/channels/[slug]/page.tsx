'use client';

import { getUser, logout } from '@/api/api';
import Loader from '@/components/Loader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { notFound } from 'next/navigation';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function Channels() {
  const router = useRouter();
  const params = useParams();
  const queryClient = useQueryClient();

  if (decodeURIComponent(String(params.slug)) !== '@me') {
    notFound();
  }

  const { isPending, data } = useQuery({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: 1000 * 20,
  });

  const onLogout = async () => {
    const result = await logout();

    if (result && !result.success) {
      if (result.msg) {
        toast.error(String(result.msg));
      }
    } else {
      toast.success('Successfully logged out');
      queryClient.removeQueries({ queryKey: ['user'] });
      router.push('/');
    }
  };

  if (isPending) return <Loader />;

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="max-w-md w-full shadow-xl rounded-2xl">
        <CardContent className="p-6 flex flex-col items-center gap-4">
          <span className="text-xl font-semibold">{data.username}</span>
          <Button variant="outline" size="sm" onClick={() => onLogout()} className="flex items-center gap-2 cursor-pointer">
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
