import { afterAll, expect, mock, test } from 'bun:test';

let friendship: { id: string } | null = null;
let sharedServer: { id: string } | null = null;
let pendingRequest: { id: string } | null = null;
let sharedServerArgs: { where: { userId: string; server: { members: { some: { userId: string } }; bans: { none: { userId: string } } } } } | null = null;

const friendshipFind = mock(async () => friendship);
const serverMemberFind = mock(async (args: { where: { userId: string; server: { members: { some: { userId: string } }; bans: { none: { userId: string } } } } }) => {
  sharedServerArgs = args;
  return sharedServer;
});
const friendRequestFind = mock(async (_args: { where: { OR: { senderId: string; receiverId: string }[] } }) => pendingRequest);

mock.module('../db', () => ({
  prisma: {
    friendship: { findUnique: friendshipFind },
    serverMember: { findFirst: serverMemberFind },
    friendRequest: { findFirst: friendRequestFind },
  },
}));

const { canViewUser } = await import('./profiles');

afterAll(() => mock.restore());

const reset = () => {
  friendship = null;
  sharedServer = null;
  pendingRequest = null;
  sharedServerArgs = null;
};

test('lets users view themselves without a lookup', async () => {
  reset();
  friendshipFind.mockClear();

  expect(await canViewUser('user-a', 'user-a')).toBe(true);
  expect(friendshipFind).not.toHaveBeenCalled();
});

test('lets friends and server co-members view each other', async () => {
  reset();
  friendship = { id: 'friendship-1' };
  expect(await canViewUser('user-a', 'user-b')).toBe(true);

  reset();
  sharedServer = { id: 'member-1' };
  expect(await canViewUser('user-a', 'user-b')).toBe(true);
  expect(sharedServerArgs?.where.server.bans).toEqual({ none: { userId: 'user-a' } });
});

test('lets pending requesters and receivers view each other', async () => {
  reset();
  pendingRequest = { id: 'request-1' };

  expect(await canViewUser('user-a', 'user-b')).toBe(true);
  expect(friendRequestFind.mock.calls[0]![0].where.OR).toEqual([
    { senderId: 'user-a', receiverId: 'user-b' },
    { senderId: 'user-b', receiverId: 'user-a' },
  ]);

  expect(await canViewUser('user-b', 'user-a')).toBe(true);
});

test('hides unrelated users', async () => {
  reset();

  expect(await canViewUser('user-a', 'user-b')).toBe(false);
});
