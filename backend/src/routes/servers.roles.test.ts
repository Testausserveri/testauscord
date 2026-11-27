import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type ServerRow = { id: string; ownerId: string };
type MemberRow = { id: string; serverId: string; userId: string };
type RoleRow = {
  id: string;
  serverId: string;
  name: string;
  color: number | null;
  permissions: number;
  position: number;
  isDefault: boolean;
  createdAt: Date;
};
type AssignmentRow = { id: string; roleId: string; serverMemberId: string };
type BanRow = { serverId: string; userId: string };
type RoleWhere = {
  id?: string | { not?: string; in?: string[] };
  serverId?: string;
  name?: { equals: string; mode: string };
  isDefault?: boolean;
};
type Select = Record<string, boolean> | undefined;

let servers: ServerRow[] = [];
let members: MemberRow[] = [];
let roles: RoleRow[] = [];
let assignments: AssignmentRow[] = [];
let bans: BanRow[] = [];
let idCounter = 0;

const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

const matchesWhere = (role: RoleRow, where: RoleWhere) => {
  if (where.serverId !== undefined && role.serverId !== where.serverId) return false;
  if (where.isDefault !== undefined && role.isDefault !== where.isDefault) return false;

  if (typeof where.id === 'string' && role.id !== where.id) return false;

  if (where.id && typeof where.id === 'object') {
    if (where.id.not !== undefined && role.id === where.id.not) return false;
    if (where.id.in !== undefined && !where.id.in.includes(role.id)) return false;
  }

  if (where.name && role.name.toLowerCase() !== where.name.equals.toLowerCase()) return false;

  return true;
};

const selectRole = (role: RoleRow, select: Select) => {
  if (!select) return role;

  return Object.fromEntries(
    Object.entries(select)
      .filter(([, include]) => include)
      .map(([key]) => [key, role[key as keyof RoleRow]]),
  );
};

const findAccessMember = mock(async ({ where }: { where: { serverId: string; userId: string } }) => {
  if (bans.some((ban) => ban.serverId === where.serverId && ban.userId === where.userId)) return null;

  const server = servers.find((entry) => entry.id === where.serverId);
  const member = members.find((entry) => entry.serverId === where.serverId && entry.userId === where.userId);

  if (!server || !member) return null;

  const defaultRole = roles.find((role) => role.serverId === where.serverId && role.isDefault);
  const assigned = assignments
    .filter((assignment) => assignment.serverMemberId === member.id)
    .map((assignment) => roles.find((role) => role.id === assignment.roleId))
    .filter((role): role is RoleRow => role !== undefined);

  return {
    server: { ownerId: server.ownerId, roles: defaultRole ? [{ permissions: defaultRole.permissions }] : [] },
    roles: assigned.map((role) => ({ role: { permissions: role.permissions, position: role.position } })),
  };
});

const findMember = mock(async ({ where }: { where: { serverId_userId: { serverId: string; userId: string } } }) => {
  const { serverId, userId } = where.serverId_userId;
  const member = members.find((entry) => entry.serverId === serverId && entry.userId === userId);

  return member ? { id: member.id } : null;
});

const findRole = mock(async ({ where }: { where: RoleWhere }) => roles.find((role) => matchesWhere(role, where)) ?? null);

const findRoles = mock(async ({ where, orderBy }: { where: RoleWhere; orderBy?: { position: 'asc' | 'desc' } }) => {
  const found = roles.filter((role) => matchesWhere(role, where));

  return found.sort((a, b) => (orderBy?.position === 'desc' ? b.position - a.position : a.position - b.position));
});

const createRole = mock(async ({ data, select }: { data: Omit<RoleRow, 'createdAt'>; select?: Select }) => {
  const role: RoleRow = { ...data, isDefault: data.isDefault ?? false, createdAt: new Date() };
  roles.push(role);

  return selectRole(role, select);
});

const updateRole = mock(async ({ where, data, select }: { where: { id: string }; data: Partial<RoleRow>; select?: Select }) => {
  const role = roles.find((entry) => entry.id === where.id);
  if (!role) throw new Error('Role not found');

  Object.assign(role, data);

  return selectRole(role, select);
});

const deleteRole = mock(async ({ where }: { where: { id: string } }) => {
  const role = roles.find((entry) => entry.id === where.id);
  roles = roles.filter((entry) => entry.id !== where.id);
  assignments = assignments.filter((assignment) => assignment.roleId !== where.id);

  return role;
});

const deleteAssignments = mock(async ({ where }: { where: { serverMemberId: string } }) => {
  const before = assignments.length;
  assignments = assignments.filter((assignment) => assignment.serverMemberId !== where.serverMemberId);

  return { count: before - assignments.length };
});

const createAssignments = mock(async ({ data }: { data: AssignmentRow[] }) => {
  assignments.push(...data);

  return { count: data.length };
});

const queryRaw = mock(async () => [{ id: 'locked' }]);

type Tx = {
  role: { findMany: typeof findRoles; create: typeof createRole; update: typeof updateRole };
  $queryRaw: typeof queryRaw;
};

const transaction = async (arg: unknown) => {
  if (typeof arg === 'function') {
    const tx: Tx = { role: { findMany: findRoles, create: createRole, update: updateRole }, $queryRaw: queryRaw };

    return (arg as (tx: Tx) => Promise<unknown>)(tx);
  }

  return Promise.all(arg as Promise<unknown>[]);
};

mock.module('../db', () => ({
  prisma: {
    serverMember: { findFirst: findAccessMember, findUnique: findMember },
    role: { findFirst: findRole, findMany: findRoles, create: createRole, update: updateRole, delete: deleteRole },
    memberRole: { deleteMany: deleteAssignments, createMany: createAssignments },
    $transaction: transaction,
  },
}));

const { default: serversRoute } = await import('./servers');
const { PERMISSIONS } = await import('../services/permissions');

const addRole = (data: { serverId: string; name: string; position: number; permissions?: number; color?: number | null; isDefault?: boolean }) => {
  const role: RoleRow = {
    id: nextId('role'),
    serverId: data.serverId,
    name: data.name,
    color: data.color ?? null,
    permissions: data.permissions ?? 0,
    position: data.position,
    isDefault: data.isDefault ?? false,
    createdAt: new Date(),
  };

  roles.push(role);

  return role;
};

const assign = (serverMemberId: string, roleId: string) => {
  assignments.push({ id: nextId('assignment'), roleId, serverMemberId });
};

const seedServer = (suffix: string) => {
  const serverId = `server-${suffix}`;
  const ownerId = `owner-${suffix}`;
  const memberId = `member-${suffix}`;
  const otherId = `other-${suffix}`;

  servers.push({ id: serverId, ownerId });

  const ownerMember = { id: `membership-owner-${suffix}`, serverId, userId: ownerId };
  const memberMember = { id: `membership-${suffix}`, serverId, userId: memberId };
  const otherMember = { id: `membership-other-${suffix}`, serverId, userId: otherId };
  members.push(ownerMember, memberMember, otherMember);

  const everyone = addRole({ serverId, name: '@everyone', position: 0, isDefault: true });

  return { serverId, ownerId, memberId, otherId, ownerMember, memberMember, otherMember, everyone };
};

const createApp = (id: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id, username: 'alice' });
    c.set('session', { id: `session-${id}`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/servers', serversRoute);

  return app;
};

const post = (app: Hono<{ Variables: Variables }>, path: string, body: unknown) =>
  app.request(`/servers${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const patch = (app: Hono<{ Variables: Variables }>, path: string, body: unknown) =>
  app.request(`/servers${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const put = (app: Hono<{ Variables: Variables }>, path: string, body: unknown) =>
  app.request(`/servers${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const del = (app: Hono<{ Variables: Variables }>, path: string) => app.request(`/servers${path}`, { method: 'DELETE' });

beforeEach(() => {
  servers = [];
  members = [];
  roles = [];
  assignments = [];
  bans = [];
  idCounter = 0;
  findAccessMember.mockClear();
  findMember.mockClear();
  findRole.mockClear();
  findRoles.mockClear();
  createRole.mockClear();
  updateRole.mockClear();
  deleteRole.mockClear();
  deleteAssignments.mockClear();
  createAssignments.mockClear();
  queryRaw.mockClear();
});

afterAll(() => mock.restore());

test('owner creates a role at the top', async () => {
  const { serverId, ownerId } = seedServer('create-owner');

  const response = await post(createApp(ownerId), `/${serverId}/roles`, {
    name: 'Mod',
    color: 0x336699,
    permissions: PERMISSIONS.KICK_MEMBERS,
  });

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    name: 'Mod',
    color: 0x336699,
    permissions: PERMISSIONS.KICK_MEMBERS,
    position: 1,
    isDefault: false,
  });
});

test('a manager creates a role below their own and shifts higher roles up', async () => {
  const { serverId, memberId, memberMember } = seedServer('create-manager');
  const lower = addRole({ serverId, name: 'Lower', position: 1, permissions: PERMISSIONS.MANAGE_INVITES });
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES | PERMISSIONS.KICK_MEMBERS });
  const higher = addRole({ serverId, name: 'Higher', position: 3, permissions: PERMISSIONS.MANAGE_ROLES });
  assign(memberMember.id, actor.id);

  const response = await post(createApp(memberId), `/${serverId}/roles`, { name: 'New', permissions: PERMISSIONS.KICK_MEMBERS });

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ name: 'New', position: 2, isDefault: false });
  expect(lower.position).toBe(1);
  expect(actor.position).toBe(3);
  expect(higher.position).toBe(4);
});

test('rejects a duplicate role name case-insensitively', async () => {
  const { serverId, ownerId } = seedServer('duplicate');
  addRole({ serverId, name: 'Mod', position: 1 });

  const response = await post(createApp(ownerId), `/${serverId}/roles`, { name: 'mod' });

  expect(response.status).toBe(409);
});

test('rejects invalid colors, names and unknown permission bits', async () => {
  const { serverId, ownerId } = seedServer('invalid');
  const app = createApp(ownerId);

  expect((await post(app, `/${serverId}/roles`, { name: 'A', color: 0x1000000 })).status).toBe(400);
  expect((await post(app, `/${serverId}/roles`, { name: 'B', color: -1 })).status).toBe(400);
  expect((await post(app, `/${serverId}/roles`, { name: 'C', permissions: 1 << 7 })).status).toBe(400);
  expect((await post(app, `/${serverId}/roles`, { name: 'bad\u0000name' })).status).toBe(400);
  expect((await post(app, `/${serverId}/roles`, { name: 'bad\u202ename' })).status).toBe(400);
});

test('rejects an empty role name', async () => {
  const { serverId, ownerId } = seedServer('empty-name');

  expect((await post(createApp(ownerId), `/${serverId}/roles`, { name: '   ' })).status).toBe(400);
});

test('rejects role creation without MANAGE_ROLES', async () => {
  const { serverId, memberId } = seedServer('no-permission');

  expect((await post(createApp(memberId), `/${serverId}/roles`, { name: 'Nope' })).status).toBe(403);
});

test('rejects a roleless manager even when @everyone grants MANAGE_ROLES', async () => {
  const { serverId, memberId, everyone } = seedServer('highest-zero');
  everyone.permissions = PERMISSIONS.MANAGE_ROLES;

  expect((await post(createApp(memberId), `/${serverId}/roles`, { name: 'Nope' })).status).toBe(403);
});

test('rejects creating a role with permissions the actor lacks', async () => {
  const { serverId, memberId, memberMember } = seedServer('grant-create');
  const actor = addRole({ serverId, name: 'Actor', position: 1, permissions: PERMISSIONS.MANAGE_ROLES });
  assign(memberMember.id, actor.id);

  expect((await post(createApp(memberId), `/${serverId}/roles`, { name: 'Nope', permissions: PERMISSIONS.BAN_MEMBERS })).status).toBe(403);
});

test('edits a role below the actor', async () => {
  const { serverId, memberId, memberMember } = seedServer('patch');
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES | PERMISSIONS.KICK_MEMBERS });
  const target = addRole({ serverId, name: 'Target', position: 1 });
  assign(memberMember.id, actor.id);

  const response = await patch(createApp(memberId), `/${serverId}/roles/${target.id}`, {
    name: 'Renamed',
    color: 0x123456,
    permissions: PERMISSIONS.KICK_MEMBERS,
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: target.id,
    name: 'Renamed',
    color: 0x123456,
    permissions: PERMISSIONS.KICK_MEMBERS,
    position: 1,
    isDefault: false,
  });
});

test('only the owner can edit @everyone', async () => {
  const { serverId, memberId, memberMember, everyone } = seedServer('patch-default');
  const actor = addRole({ serverId, name: 'Actor', position: 1, permissions: PERMISSIONS.MANAGE_ROLES });
  assign(memberMember.id, actor.id);

  expect((await patch(createApp(memberId), `/${serverId}/roles/${everyone.id}`, { permissions: PERMISSIONS.MANAGE_INVITES })).status).toBe(403);
});

test('owner edits @everyone permissions but cannot rename it', async () => {
  const { serverId, ownerId, everyone } = seedServer('patch-default-owner');
  const app = createApp(ownerId);

  const updated = await patch(app, `/${serverId}/roles/${everyone.id}`, { permissions: PERMISSIONS.MANAGE_INVITES });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ id: everyone.id, permissions: PERMISSIONS.MANAGE_INVITES, isDefault: true });

  expect((await patch(app, `/${serverId}/roles/${everyone.id}`, { name: 'Everyone' })).status).toBe(400);
});

test('rejects editing a role at or above the actor highest position', async () => {
  const { serverId, memberId, memberMember } = seedServer('patch-hierarchy');
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES });
  const higher = addRole({ serverId, name: 'Higher', position: 3 });
  assign(memberMember.id, actor.id);
  const app = createApp(memberId);

  expect((await patch(app, `/${serverId}/roles/${higher.id}`, { name: 'Nope' })).status).toBe(403);
  expect((await patch(app, `/${serverId}/roles/${actor.id}`, { name: 'Nope' })).status).toBe(403);
});

test('rejects granting a permission the actor lacks', async () => {
  const { serverId, memberId, memberMember } = seedServer('patch-grant');
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES });
  const target = addRole({ serverId, name: 'Target', position: 1 });
  assign(memberMember.id, actor.id);

  expect((await patch(createApp(memberId), `/${serverId}/roles/${target.id}`, { permissions: PERMISSIONS.BAN_MEMBERS })).status).toBe(403);
});

test('deletes a role and renumbers the rest', async () => {
  const { serverId, ownerId, ownerMember } = seedServer('delete');
  const first = addRole({ serverId, name: 'First', position: 1 });
  const second = addRole({ serverId, name: 'Second', position: 2 });
  const third = addRole({ serverId, name: 'Third', position: 3 });
  assign(ownerMember.id, second.id);

  const response = await del(createApp(ownerId), `/${serverId}/roles/${second.id}`);

  expect(response.status).toBe(204);
  expect(first.position).toBe(1);
  expect(third.position).toBe(2);
  expect(roles.some((role) => role.id === second.id)).toBe(false);
  expect(assignments.some((assignment) => assignment.roleId === second.id)).toBe(false);
});

test('rejects deleting @everyone', async () => {
  const { serverId, ownerId, everyone } = seedServer('delete-default');

  expect((await del(createApp(ownerId), `/${serverId}/roles/${everyone.id}`)).status).toBe(403);
});

test('rejects deleting a role at or above the actor highest position', async () => {
  const { serverId, memberId, memberMember } = seedServer('delete-hierarchy');
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES });
  const higher = addRole({ serverId, name: 'Higher', position: 3 });
  assign(memberMember.id, actor.id);
  const app = createApp(memberId);

  expect((await del(app, `/${serverId}/roles/${higher.id}`)).status).toBe(403);
  expect((await del(app, `/${serverId}/roles/${actor.id}`)).status).toBe(403);
});

test('reorders roles below the actor highest position', async () => {
  const { serverId, memberId, memberMember } = seedServer('order');
  const lowerA = addRole({ serverId, name: 'Lower A', position: 1 });
  const lowerB = addRole({ serverId, name: 'Lower B', position: 2 });
  const actor = addRole({ serverId, name: 'Actor', position: 3, permissions: PERMISSIONS.MANAGE_ROLES });
  assign(memberMember.id, actor.id);

  const response = await put(createApp(memberId), `/${serverId}/roles/order`, { roleIds: [lowerB.id, lowerA.id, actor.id] });

  expect(response.status).toBe(200);
  expect(lowerB.position).toBe(1);
  expect(lowerA.position).toBe(2);
  expect(actor.position).toBe(3);
});

test('rejects moving a role at or above the actor highest position', async () => {
  const { serverId, memberId, memberMember } = seedServer('order-protected');
  const lower = addRole({ serverId, name: 'Lower', position: 1 });
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES });
  const higher = addRole({ serverId, name: 'Higher', position: 3 });
  assign(memberMember.id, actor.id);

  const response = await put(createApp(memberId), `/${serverId}/roles/order`, { roleIds: [lower.id, higher.id, actor.id] });

  expect(response.status).toBe(403);
});

test('rejects an order payload with the wrong set of roles', async () => {
  const { serverId, ownerId } = seedServer('order-set');
  const role = addRole({ serverId, name: 'Role', position: 1 });
  const app = createApp(ownerId);

  expect((await put(app, `/${serverId}/roles/order`, { roleIds: [] })).status).toBe(400);
  expect((await put(app, `/${serverId}/roles/order`, { roleIds: [role.id, role.id] })).status).toBe(400);
});

test('replaces a member role assignment', async () => {
  const { serverId, ownerId, memberId, memberMember } = seedServer('assign');
  const oldRole = addRole({ serverId, name: 'Old', position: 1 });
  const newRole = addRole({ serverId, name: 'New', position: 2 });
  assign(memberMember.id, oldRole.id);

  const response = await put(createApp(ownerId), `/${serverId}/members/${memberId}/roles`, { roleIds: [newRole.id] });

  expect(response.status).toBe(204);
  expect(assignments.filter((assignment) => assignment.serverMemberId === memberMember.id).map((assignment) => assignment.roleId)).toEqual([newRole.id]);
});

test('rejects assigning @everyone', async () => {
  const { serverId, ownerId, memberId, everyone } = seedServer('assign-default');

  expect((await put(createApp(ownerId), `/${serverId}/members/${memberId}/roles`, { roleIds: [everyone.id] })).status).toBe(400);
});

test('rejects assigning a role at or above the actor highest position', async () => {
  const { serverId, memberId, otherId, memberMember } = seedServer('assign-hierarchy');
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES });
  const targetRole = addRole({ serverId, name: 'Target', position: 1 });
  const higher = addRole({ serverId, name: 'Higher', position: 3 });
  assign(memberMember.id, actor.id);
  const app = createApp(memberId);

  expect((await put(app, `/${serverId}/members/${otherId}/roles`, { roleIds: [higher.id] })).status).toBe(403);
  expect((await put(app, `/${serverId}/members/${otherId}/roles`, { roleIds: [targetRole.id] })).status).toBe(204);
});

test('rejects changing the roles of a member at or above the actor highest position', async () => {
  const { serverId, memberId, otherId, otherMember, memberMember } = seedServer('assign-target');
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES });
  const higher = addRole({ serverId, name: 'Higher', position: 3 });
  assign(memberMember.id, actor.id);
  assign(otherMember.id, higher.id);

  expect((await put(createApp(memberId), `/${serverId}/members/${otherId}/roles`, { roleIds: [] })).status).toBe(403);
});

test('rejects assigning a role with permissions the actor lacks', async () => {
  const { serverId, memberId, otherId, memberMember } = seedServer('assign-grant');
  const actor = addRole({ serverId, name: 'Actor', position: 2, permissions: PERMISSIONS.MANAGE_ROLES });
  const bannedRole = addRole({ serverId, name: 'Banner', position: 1, permissions: PERMISSIONS.BAN_MEMBERS });
  assign(memberMember.id, actor.id);

  expect((await put(createApp(memberId), `/${serverId}/members/${otherId}/roles`, { roleIds: [bannedRole.id] })).status).toBe(403);
});

test('rejects editing the owner roles', async () => {
  const { serverId, ownerId } = seedServer('assign-owner');
  const role = addRole({ serverId, name: 'Role', position: 1 });

  expect((await put(createApp(ownerId), `/${serverId}/members/${ownerId}/roles`, { roleIds: [role.id] })).status).toBe(400);
});

test('rejects duplicate and missing role ids in an assignment', async () => {
  const { serverId, ownerId, memberId } = seedServer('assign-invalid');
  const role = addRole({ serverId, name: 'Role', position: 1 });
  const app = createApp(ownerId);

  expect((await put(app, `/${serverId}/members/${memberId}/roles`, { roleIds: [role.id, role.id] })).status).toBe(400);
  expect((await put(app, `/${serverId}/members/${memberId}/roles`, { roleIds: ['missing-role'] })).status).toBe(400);
});

test('rejects assigning a role from another server', async () => {
  const first = seedServer('assign-foreign-a');
  const second = seedServer('assign-foreign-b');
  const foreign = addRole({ serverId: second.serverId, name: 'Foreign', position: 1 });

  expect((await put(createApp(first.ownerId), `/${first.serverId}/members/${first.memberId}/roles`, { roleIds: [foreign.id] })).status).toBe(400);
});

test('hides role endpoints from non-members', async () => {
  const { serverId, memberId } = seedServer('outsider');
  const app = createApp('outsider-roles');

  expect((await post(app, `/${serverId}/roles`, { name: 'Nope' })).status).toBe(404);
  expect((await put(app, `/${serverId}/members/${memberId}/roles`, { roleIds: [] })).status).toBe(404);
});

test('hides role endpoints from a banned member with a stale membership row', async () => {
  const { serverId, memberId } = seedServer('banned');
  bans.push({ serverId, userId: memberId });

  expect((await post(createApp(memberId), `/${serverId}/roles`, { name: 'Nope' })).status).toBe(404);
});

test('returns 404 for a missing role', async () => {
  const { serverId, ownerId } = seedServer('missing-role');
  const app = createApp(ownerId);

  expect((await patch(app, `/${serverId}/roles/missing`, { name: 'Nope' })).status).toBe(404);
  expect((await del(app, `/${serverId}/roles/missing`)).status).toBe(404);
});

test('caps a server at 25 roles including @everyone', async () => {
  const { serverId, ownerId } = seedServer('cap');

  for (let index = 1; index < 25; index++) {
    addRole({ serverId, name: `Role ${index}`, position: index });
  }

  expect((await post(createApp(ownerId), `/${serverId}/roles`, { name: 'Overflow' })).status).toBe(409);
});
