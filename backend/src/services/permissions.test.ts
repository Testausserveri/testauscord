import { afterAll, expect, mock, test } from 'bun:test';

type RoleRef = { role: { permissions: number; position: number } };

type MemberRow = {
  server: { ownerId: string; roles: { permissions: number }[] };
  roles: RoleRef[];
};

type FindArgs = {
  where: {
    serverId: string;
    userId: string;
    server: { bans: { none: { userId: string } } };
  };
  select: unknown;
};

let member: MemberRow | null = null;
let lastArgs: FindArgs | null = null;

const findFirst = mock(async (args: FindArgs) => {
  lastArgs = args;
  return member;
});

mock.module('../db', () => ({ prisma: { serverMember: { findFirst } } }));

const { ALL_PERMISSIONS, PERMISSIONS, getMemberAccess, hasPermission, hasUnknownPermissionBits, requirePermission } = await import('./permissions');
const frontend = await import('../../../frontend/lib/permissions');

afterAll(() => mock.restore());

const seed = (row: MemberRow | null) => {
  member = row;
  lastArgs = null;
};

const role = (permissions: number, position: number): RoleRef => ({ role: { permissions, position } });

test('mirrors permission bits in the frontend', () => {
  expect(frontend.PERMISSIONS).toEqual(PERMISSIONS);
});

test('owner gets every permission and bypasses hierarchy', async () => {
  seed({ server: { ownerId: 'owner-1', roles: [] }, roles: [] });

  const access = await getMemberAccess('server-1', 'owner-1');

  expect(access).toEqual({ isMember: true, isOwner: true, permissions: ALL_PERMISSIONS, highestPosition: 1_000_000 });
  expect(lastArgs?.where).toEqual({ serverId: 'server-1', userId: 'owner-1', server: { bans: { none: { userId: 'owner-1' } } } });
});

test('default role applies with no assigned roles', async () => {
  seed({ server: { ownerId: 'owner-1', roles: [{ permissions: PERMISSIONS.MANAGE_INVITES }] }, roles: [] });

  const access = await getMemberAccess('server-1', 'member-1');

  expect(access).toEqual({ isMember: true, isOwner: false, permissions: PERMISSIONS.MANAGE_INVITES, highestPosition: 0 });
});

test('unions default and assigned roles and tracks the highest position', async () => {
  seed({
    server: { ownerId: 'owner-1', roles: [{ permissions: PERMISSIONS.MANAGE_INVITES }] },
    roles: [role(PERMISSIONS.KICK_MEMBERS, 2), role(PERMISSIONS.BAN_MEMBERS, 5)],
  });

  const access = await getMemberAccess('server-1', 'member-1');

  expect(access?.permissions).toBe(PERMISSIONS.MANAGE_INVITES | PERMISSIONS.KICK_MEMBERS | PERMISSIONS.BAN_MEMBERS);
  expect(access?.highestPosition).toBe(5);
});

test('missing default role gives no default bits', async () => {
  seed({ server: { ownerId: 'owner-1', roles: [] }, roles: [role(PERMISSIONS.KICK_MEMBERS, 1)] });

  expect((await getMemberAccess('server-1', 'member-1'))?.permissions).toBe(PERMISSIONS.KICK_MEMBERS);
});

test('non-member or banned member gets null', async () => {
  seed(null);

  expect(await getMemberAccess('server-1', 'stranger')).toBeNull();
});

test('rejects unknown permission bits', () => {
  expect(hasUnknownPermissionBits(0)).toBe(false);
  expect(hasUnknownPermissionBits(ALL_PERMISSIONS)).toBe(false);
  expect(hasUnknownPermissionBits(1 << 8)).toBe(true);
  expect(hasUnknownPermissionBits(ALL_PERMISSIONS | (1 << 8))).toBe(true);
});

test('hasPermission checks a single bit', () => {
  const access = { isMember: true, isOwner: false, permissions: PERMISSIONS.KICK_MEMBERS, highestPosition: 1 };

  expect(hasPermission(access, PERMISSIONS.KICK_MEMBERS)).toBe(true);
  expect(hasPermission(access, PERMISSIONS.BAN_MEMBERS)).toBe(false);
});

test('requirePermission returns 404, 403 or the access', async () => {
  seed(null);
  const missing = await requirePermission('server-1', 'user-1', PERMISSIONS.KICK_MEMBERS);
  expect(missing instanceof Response).toBe(true);
  if (missing instanceof Response) expect(missing.status).toBe(404);

  seed({ server: { ownerId: 'owner-1', roles: [] }, roles: [] });
  const denied = await requirePermission('server-1', 'member-1', PERMISSIONS.KICK_MEMBERS);
  expect(denied instanceof Response).toBe(true);
  if (denied instanceof Response) expect(denied.status).toBe(403);

  seed({ server: { ownerId: 'owner-1', roles: [{ permissions: PERMISSIONS.KICK_MEMBERS }] }, roles: [] });
  expect(await requirePermission('server-1', 'member-1', PERMISSIONS.KICK_MEMBERS)).toEqual({
    isMember: true,
    isOwner: false,
    permissions: PERMISSIONS.KICK_MEMBERS,
    highestPosition: 0,
  });
});
