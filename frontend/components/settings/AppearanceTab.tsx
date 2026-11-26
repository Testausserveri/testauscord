'use client';

import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();

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
    </div>
  );
}
