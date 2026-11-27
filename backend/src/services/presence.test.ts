import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

type FriendshipRow = { userAId: string; userBId: string };
type ServerRow = {
  server: {
    members: { userId: string }[];
    bans: { userId: string }[];
  };
};
type DmRow = { channel: { members: { userId: string }[] } };

let friendships: FriendshipRow[] = [];
let memberships: ServerRow[] = [];
let dmMemberships: DmRow[] = [];
let connected = false;

const friendshipFindMany = mock(async () => friendships);
const serverMemberFindMany = mock(async () => memberships);
const channelMemberFindMany = mock(async () => dmMemberships);

mock.module('../db', () => ({
  prisma: {
    friendship: { findMany: friendshipFindMany },
    serverMember: { findMany: serverMemberFindMany },
    channelMember: { findMany: channelMemberFindMany },
  },
}));

mock.module('../realtime/connections', () => ({
  isUserConnected: () => connected,
}));

const { canViewPresence, effectivePresence, presenceRecipientIds } = await import('./presence');

afterAll(() => mock.restore());

beforeEach(() => {
  friendships = [];
  memberships = [];
  dmMemberships = [];
  connected = false;
});

test('effective presence follows the connection and stored status', () => {
  connected = true;
  expect(effectivePresence('alice', 'ONLINE')).toBe('ONLINE');
  expect(effectivePresence('alice', 'IDLE')).toBe('IDLE');
  expect(effectivePresence('alice', 'DND')).toBe('DND');
  expect(effectivePresence('alice', 'INVISIBLE')).toBe('OFFLINE');

  connected = false;
  expect(effectivePresence('alice', 'ONLINE')).toBe('OFFLINE');
  expect(effectivePresence('alice', 'INVISIBLE')).toBe('OFFLINE');
});

test('collects friends, shared server members and DM users without duplicates', async () => {
  friendships = [
    { userAId: 'alice', userBId: 'bob' },
    { userAId: 'carol', userBId: 'alice' },
  ];
  memberships = [
    {
      server: {
        members: [{ userId: 'bob' }, { userId: 'dave' }],
        bans: [],
      },
    },
  ];
  dmMemberships = [{ channel: { members: [{ userId: 'carol' }, { userId: 'erin' }] } }];

  const ids = await presenceRecipientIds('alice');

  expect(new Set(ids)).toEqual(new Set(['bob', 'carol', 'dave', 'erin']));
  expect(ids).toHaveLength(4);
});

test('excludes banned members per server but keeps users from another shared server', async () => {
  memberships = [
    {
      server: {
        members: [{ userId: 'bob' }, { userId: 'carol' }],
        bans: [{ userId: 'bob' }],
      },
    },
    {
      server: {
        members: [{ userId: 'bob' }, { userId: 'dave' }],
        bans: [],
      },
    },
  ];

  const ids = await presenceRecipientIds('alice');

  expect(new Set(ids)).toEqual(new Set(['bob', 'carol', 'dave']));
});

test('never includes the user', async () => {
  friendships = [{ userAId: 'alice', userBId: 'alice' }];
  memberships = [{ server: { members: [{ userId: 'alice' }], bans: [] } }];
  dmMemberships = [{ channel: { members: [{ userId: 'alice' }] } }];

  expect(await presenceRecipientIds('alice')).toEqual([]);
});

test('allows a friend, a shared server member, a DM user and the user', async () => {
  friendships = [{ userAId: 'alice', userBId: 'bob' }];
  expect(await canViewPresence('alice', 'bob')).toBe(true);

  friendships = [];
  memberships = [{ server: { members: [{ userId: 'carol' }], bans: [] } }];
  expect(await canViewPresence('alice', 'carol')).toBe(true);

  memberships = [];
  dmMemberships = [{ channel: { members: [{ userId: 'dave' }] } }];
  expect(await canViewPresence('alice', 'dave')).toBe(true);

  expect(await canViewPresence('alice', 'alice')).toBe(true);
});

test('denies a stranger and a banned shared server member', async () => {
  expect(await canViewPresence('alice', 'stranger')).toBe(false);

  memberships = [{ server: { members: [{ userId: 'bob' }], bans: [{ userId: 'bob' }] } }];
  expect(await canViewPresence('alice', 'bob')).toBe(false);
});
