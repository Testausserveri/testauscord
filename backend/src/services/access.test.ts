import { afterAll, expect, mock, test } from 'bun:test';

type ChannelRow = {
  serverId: string | null;
  members: { id: string }[];
  server: { members: { id: string }[]; bans: { id: string }[] } | null;
};

type FindArgs = {
  where: { id: string };
  select: { server: { select: { bans: { where: { userId: string }; select: { id: true } } } } };
};

let channel: ChannelRow | null = null;
let lastArgs: FindArgs | null = null;

const findUnique = mock(async (args: FindArgs) => {
  lastArgs = args;
  return channel;
});

mock.module('../db', () => ({ prisma: { channel: { findUnique } } }));

const { canAccessChannel } = await import('./access');

afterAll(() => mock.restore());

const seed = (row: ChannelRow | null) => {
  channel = row;
  lastArgs = null;
};

test('allows a server member and checks the ban list for that user', async () => {
  seed({ serverId: 'server-1', members: [], server: { members: [{ id: 'member-1' }], bans: [] } });

  expect(await canAccessChannel('user-1', 'channel-1')).toBe(true);
  expect(lastArgs?.select.server.select.bans).toEqual({ where: { userId: 'user-1' }, select: { id: true } });
});

test('blocks a server member with an active ban', async () => {
  seed({ serverId: 'server-1', members: [], server: { members: [{ id: 'member-1' }], bans: [{ id: 'ban-1' }] } });

  expect(await canAccessChannel('user-1', 'channel-1')).toBe(false);
});

test('keeps DM access on channel membership', async () => {
  seed({ serverId: null, members: [{ id: 'member-1' }], server: null });
  expect(await canAccessChannel('user-1', 'dm-1')).toBe(true);

  seed({ serverId: null, members: [], server: null });
  expect(await canAccessChannel('user-1', 'dm-1')).toBe(false);
});

test('blocks a missing channel', async () => {
  seed(null);

  expect(await canAccessChannel('user-1', 'missing')).toBe(false);
});
