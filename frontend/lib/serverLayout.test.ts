import { expect, test } from 'bun:test';
import { groupServer, moveCategory, moveChannel, toLayoutPayload } from './serverLayout';
import type { ServerCategory, ServerChannel, ServerLayoutGroup } from '@/types/types';

const category = (id: string, position: number): ServerCategory => ({ id, name: id, position });
const channel = (id: string, categoryId: string | null, position: number): ServerChannel => ({ id, name: id, type: 'TEXT', categoryId, position });

const groups = (): ServerLayoutGroup[] => [
  { categoryId: null, channelIds: ['u1', 'u2'] },
  { categoryId: 'a', channelIds: ['a1', 'a2', 'a3'] },
  { categoryId: 'b', channelIds: ['b1'] },
  { categoryId: 'empty', channelIds: [] },
];

test('groups the server in render order', () => {
  const server = {
    categories: [category('b', 1), category('a', 0)],
    channels: [channel('b1', 'b', 0), channel('u2', null, 1), channel('a1', 'a', 0), channel('u1', null, 0)],
  };

  expect(groupServer(server)).toEqual({
    categories: [category('a', 0), category('b', 1)],
    groups: [
      { categoryId: null, channelIds: ['u1', 'u2'] },
      { categoryId: 'a', channelIds: ['a1'] },
      { categoryId: 'b', channelIds: ['b1'] },
    ],
  });
});

test('moves a channel within its group', () => {
  expect(moveChannel(groups(), 'channel:a1', 'channel:a3')).toEqual([
    { categoryId: null, channelIds: ['u1', 'u2'] },
    { categoryId: 'a', channelIds: ['a2', 'a3', 'a1'] },
    { categoryId: 'b', channelIds: ['b1'] },
    { categoryId: 'empty', channelIds: [] },
  ]);
});

test('moves a channel before a channel in another group', () => {
  expect(moveChannel(groups(), 'channel:u1', 'channel:a2')).toEqual([
    { categoryId: null, channelIds: ['u2'] },
    { categoryId: 'a', channelIds: ['a1', 'u1', 'a2', 'a3'] },
    { categoryId: 'b', channelIds: ['b1'] },
    { categoryId: 'empty', channelIds: [] },
  ]);
});

test('moves a channel into an empty category and back to uncategorized', () => {
  const intoEmpty = moveChannel(groups(), 'channel:a1', 'group:empty');
  expect(intoEmpty[1]).toEqual({ categoryId: 'a', channelIds: ['a2', 'a3'] });
  expect(intoEmpty[3]).toEqual({ categoryId: 'empty', channelIds: ['a1'] });

  const uncategorized = moveChannel(intoEmpty, 'channel:a1', 'group:null');
  expect(uncategorized[0]).toEqual({ categoryId: null, channelIds: ['u1', 'u2', 'a1'] });
  expect(uncategorized[3]).toEqual({ categoryId: 'empty', channelIds: [] });
});

test('appends to a category when dropped on its body', () => {
  expect(moveChannel(groups(), 'channel:u2', 'group:b')[2]).toEqual({ categoryId: 'b', channelIds: ['b1', 'u2'] });
});

test('ignores unknown channels and groups', () => {
  const current = groups();
  expect(moveChannel(current, 'channel:missing', 'channel:a1')).toBe(current);
  expect(moveChannel(current, 'channel:a1', 'group:missing')).toBe(current);
});

test('moves a category', () => {
  const categories = [category('a', 0), category('b', 1), category('c', 2)];

  expect(moveCategory(categories, 'category:b', 'category:c')).toEqual([category('a', 0), category('c', 2), category('b', 1)]);
  expect(moveCategory(categories, 'category:a', 'category:c')).toEqual([category('b', 1), category('c', 2), category('a', 0)]);
  expect(moveCategory(categories, 'category:a', 'category:a')).toBe(categories);
});

test('builds the payload from the group order', () => {
  const current = [
    { categoryId: null, channelIds: ['u1'] },
    { categoryId: 'b', channelIds: ['b1'] },
    { categoryId: 'a', channelIds: ['a1'] },
  ];

  expect(toLayoutPayload(current)).toEqual({
    categories: ['b', 'a'],
    groups: current,
  });
});
