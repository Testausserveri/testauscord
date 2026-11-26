import { expect, test } from 'bun:test';
import { nextPosition, planCategoryDelete, planChannelAssign, planLayout, type LayoutChannel, type LayoutPayload } from './serverLayout';

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

const category = (id: string, position: number) => ({ id, position });

const layoutCategories = [category('cat-a', 0), category('cat-b', 1)];
const layoutChannels = [channel('u0', null, 0), channel('a0', 'cat-a', 0), channel('b0', 'cat-b', 0)];

const validLayout: LayoutPayload = {
  categories: ['cat-a', 'cat-b'],
  groups: [
    { categoryId: null, channelIds: ['u0'] },
    { categoryId: 'cat-a', channelIds: ['a0'] },
    { categoryId: 'cat-b', channelIds: ['b0'] },
  ],
};

test('plans the new order and allows empty categories', () => {
  const categories = [category('cat-a', 0), category('cat-b', 1), category('cat-c', 2)];
  const channels = [channel('u0', null, 0), channel('a0', 'cat-a', 0), channel('a1', 'cat-a', 1)];

  expect(
    planLayout(categories, channels, {
      categories: ['cat-c', 'cat-b', 'cat-a'],
      groups: [
        { categoryId: 'cat-c', channelIds: [] },
        { categoryId: 'cat-b', channelIds: ['u0'] },
        { categoryId: 'cat-a', channelIds: ['a1', 'a0'] },
        { categoryId: null, channelIds: [] },
      ],
    }),
  ).toEqual({
    categories: [
      { id: 'cat-c', position: 0 },
      { id: 'cat-a', position: 2 },
    ],
    channels: [
      { id: 'u0', categoryId: 'cat-b', position: 0 },
      { id: 'a1', categoryId: 'cat-a', position: 0 },
      { id: 'a0', categoryId: 'cat-a', position: 1 },
    ],
  });
});

test('returns an empty plan for an unchanged layout', () => {
  expect(planLayout(layoutCategories, layoutChannels, validLayout)).toEqual({ categories: [], channels: [] });
});

test('moves a channel within a group', () => {
  const channels = [channel('a0', 'cat-a', 0), channel('a1', 'cat-a', 1), channel('a2', 'cat-a', 2)];

  expect(
    planLayout([category('cat-a', 0)], channels, {
      categories: ['cat-a'],
      groups: [
        { categoryId: 'cat-a', channelIds: ['a2', 'a0', 'a1'] },
        { categoryId: null, channelIds: [] },
      ],
    })?.channels,
  ).toEqual([
    { id: 'a2', categoryId: 'cat-a', position: 0 },
    { id: 'a0', categoryId: 'cat-a', position: 1 },
    { id: 'a1', categoryId: 'cat-a', position: 2 },
  ]);
});

test('moves a channel across groups', () => {
  const channels = [channel('u0', null, 0), channel('a0', 'cat-a', 0)];

  expect(
    planLayout([category('cat-a', 0)], channels, {
      categories: ['cat-a'],
      groups: [
        { categoryId: 'cat-a', channelIds: ['u0'] },
        { categoryId: null, channelIds: ['a0'] },
      ],
    })?.channels,
  ).toEqual([
    { id: 'u0', categoryId: 'cat-a', position: 0 },
    { id: 'a0', categoryId: null, position: 0 },
  ]);
});

test('renumbers gaps inside a group', () => {
  const channels = [channel('a0', 'cat-a', 4), channel('a1', 'cat-a', 9)];

  expect(
    planLayout([category('cat-a', 0)], channels, {
      categories: ['cat-a'],
      groups: [
        { categoryId: null, channelIds: [] },
        { categoryId: 'cat-a', channelIds: ['a0', 'a1'] },
      ],
    })?.channels,
  ).toEqual([
    { id: 'a0', categoryId: 'cat-a', position: 0 },
    { id: 'a1', categoryId: 'cat-a', position: 1 },
  ]);
});

test('accepts an empty server', () => {
  expect(planLayout([], [], { categories: [], groups: [{ categoryId: null, channelIds: [] }] })).toEqual({ categories: [], channels: [] });
});

test('rejects duplicate category ids', () => {
  expect(planLayout(layoutCategories, layoutChannels, { ...validLayout, categories: ['cat-a', 'cat-a'] })).toBeNull();
});

test('rejects a missing category id', () => {
  expect(planLayout(layoutCategories, layoutChannels, { ...validLayout, categories: ['cat-a'] })).toBeNull();
});

test('rejects a foreign category id', () => {
  expect(planLayout(layoutCategories, layoutChannels, { ...validLayout, categories: ['cat-a', 'cat-b', 'cat-x'] })).toBeNull();
});

test('rejects duplicate groups', () => {
  expect(
    planLayout(layoutCategories, layoutChannels, {
      ...validLayout,
      groups: [
        { categoryId: null, channelIds: ['u0'] },
        { categoryId: 'cat-a', channelIds: ['a0'] },
        { categoryId: 'cat-a', channelIds: ['b0'] },
      ],
    }),
  ).toBeNull();
});

test('rejects a missing group', () => {
  expect(planLayout(layoutCategories, layoutChannels, { ...validLayout, groups: validLayout.groups.slice(0, 2) })).toBeNull();
});

test('rejects duplicate channel ids', () => {
  expect(
    planLayout(layoutCategories, layoutChannels, {
      ...validLayout,
      groups: [
        { categoryId: null, channelIds: ['u0'] },
        { categoryId: 'cat-a', channelIds: ['a0'] },
        { categoryId: 'cat-b', channelIds: ['a0'] },
      ],
    }),
  ).toBeNull();
});

test('rejects a foreign channel id', () => {
  expect(
    planLayout(layoutCategories, layoutChannels, {
      ...validLayout,
      groups: [
        { categoryId: null, channelIds: ['u0'] },
        { categoryId: 'cat-a', channelIds: ['a0'] },
        { categoryId: 'cat-b', channelIds: ['foreign'] },
      ],
    }),
  ).toBeNull();
});

test('rejects a missing channel id', () => {
  expect(
    planLayout(layoutCategories, layoutChannels, {
      ...validLayout,
      groups: [
        { categoryId: null, channelIds: ['u0'] },
        { categoryId: 'cat-a', channelIds: ['a0'] },
        { categoryId: 'cat-b', channelIds: [] },
      ],
    }),
  ).toBeNull();
});
