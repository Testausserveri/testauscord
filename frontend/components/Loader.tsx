import { cn } from '@/lib/utils';

export default function Loader({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <div className="flex h-screen w-full items-center justify-center">
        <div className="animate-spin rounded-full border-4 border-gray-300 border-t-gray-900 h-12 w-12" />
      </div>
    </div>
  );
}
