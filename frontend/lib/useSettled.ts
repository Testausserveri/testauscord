import { useEffect, useState } from 'react';

const SETTLE_MS = 700;

export const useSettled = (value: string) => {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return [settled, setSettled] as const;
};
