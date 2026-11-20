import { expect, test } from 'bun:test';
import { isAllowedOrigin } from './origin';

test('allows native clients and the configured frontend origin only', () => {
  expect(isAllowedOrigin(undefined, 'http://localhost:3001')).toBe(true);
  expect(isAllowedOrigin('http://localhost:3001', 'http://localhost:3001')).toBe(true);
  expect(isAllowedOrigin('http://localhost:3002', 'http://localhost:3001')).toBe(false);
  expect(isAllowedOrigin('http://localhost:3001', '')).toBe(false);
  expect(isAllowedOrigin('http://localhost:3001', undefined)).toBe(true);
});
