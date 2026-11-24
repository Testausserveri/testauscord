import { expect, test } from 'bun:test';
import { nextPosition, planCategoryDelete, planChannelAssign, type LayoutChannel } from './serverLayout';

const channel = (id: string, categoryId: string | null, position: number): LayoutChannel => ({ id, categoryId, position });

test('appends after the current max position', () => {
  expect(nextPosition([])).toBe(0);
  expect(nextPosition([0, 1, 2])).toBe(3);
  expect(nextPosition([2, 7])).toBe(8);
});

test('assigns across groups and renumbers both', () => {
  const channels = [channel('a0', null, 0), channel('a1', null, 1), channel('b0', 'cat-1', 0), channel('b1', 'cat-1', 1)];

  expect(planChannelAssign(channels, 'a1', 'cat-1')).toEqual([
    { id: 'a0', categoryId: null, position: 0 },
    { id: 'b0', categoryId: 'cat-1', position: 0 },
    { id: 'b1', categoryId: 'cat-1', position: 1 },
    { id: 'a1', categoryId: 'cat-1', position: 2 },
  ]);
});

test('does nothing when the channel is already in the target group', () => {
  const channels = [channel('b0', 'cat-1', 0), channel('b1', 'cat-1', 1)];

  expect(planChannelAssign(channels, 'b0', 'cat-1')).toEqual([]);
});

test('moves a channel back to uncategorized', () => {
  const channels = [channel('a0', null, 0), channel('b0', 'cat-1', 0), channel('b1', 'cat-1', 1)];

  expect(planChannelAssign(channels, 'b0', null)).toEqual([
    { id: 'b1', categoryId: 'cat-1', position: 0 },
    { id: 'a0', categoryId: null, position: 0 },
    { id: 'b0', categoryId: null, position: 1 },
  ]);
});

test('keeps creation order when positions tie', () => {
  const channels = [channel('b', 'cat-1', 0), channel('a', 'cat-1', 0), channel('m', null, 0)];

  expect(planChannelAssign(channels, 'm', 'cat-1')).toEqual([
    { id: 'a', categoryId: 'cat-1', position: 0 },
    { id: 'b', categoryId: 'cat-1', position: 1 },
    { id: 'm', categoryId: 'cat-1', position: 2 },
  ]);
});

test('deletes a category by appending its channels to uncategorized', () => {
  const channels = [channel('u0', null, 0), channel('u1', null, 1), channel('c0', 'cat-1', 0), channel('c1', 'cat-1', 1), channel('c2', 'cat-1', 2)];

  expect(planCategoryDelete(channels, 'cat-1')).toEqual([
    { id: 'u0', categoryId: null, position: 0 },
    { id: 'u1', categoryId: null, position: 1 },
    { id: 'c0', categoryId: null, position: 2 },
    { id: 'c1', categoryId: null, position: 3 },
    { id: 'c2', categoryId: null, position: 4 },
  ]);
});

test('deletes an empty category without touching uncategorized positions', () => {
  const channels = [channel('u0', null, 0), channel('u1', null, 1)];

  expect(planCategoryDelete(channels, 'cat-1')).toEqual([
    { id: 'u0', categoryId: null, position: 0 },
    { id: 'u1', categoryId: null, position: 1 },
  ]);
});
