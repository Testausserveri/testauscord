'use client';

import { useTheme } from 'next-themes';
import { setAnimateAvatars, useAnimateAvatars } from '@/lib/avatarAnimation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const animateAvatars = useAnimateAvatars();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">Choose how Testauscord looks.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Theme</span>
        <div className="flex gap-2">
          {THEMES.map((option) => (
            <Button key={option.value} type="button" variant={theme === option.value ? 'default' : 'outline'} onClick={() => setTheme(option.value)}>
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Avatars</span>
        <div className="flex items-center gap-2">
          <Checkbox id="animate-avatars" checked={animateAvatars} onCheckedChange={(checked) => setAnimateAvatars(checked === true)} />
          <Label htmlFor="animate-avatars">Animate avatars</Label>
        </div>
        <p className="text-xs text-muted-foreground">Animated avatars play on hover when this is on and your system allows motion.</p>
      </div>
    </div>
  );
}
