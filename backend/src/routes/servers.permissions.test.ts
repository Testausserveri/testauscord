import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type ServerRow = { id: string; name: string; ownerId: string; iconVersion: number | null; createdAt: Date; members: string[] };
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
type MemberRow = { id: string; serverId: string; userId: string; position: number; joinedAt: Date };
type AssignmentRow = { id: string; roleId: string; serverMemberId: string };
type CategoryRow = { id: string; serverId: string; name: string; position: number; createdAt: Date };
type ChannelRow = { id: string; serverId: string; name: string; type: 'TEXT'; categoryId: string | null; position: number; createdAt: Date };
type InviteRow = { id: string; code: string; serverId: string; channelId: string | null; createdById: string; createdAt: Date; expiresAt: Date };
type BanRow = { id: string; serverId: string; userId: string; bannedById: string; reason: string | null; createdAt: Date };
type UserRow = { id: string };

let servers: ServerRow[] = [];
let roles: RoleRow[] = [];
let members: MemberRow[] = [];
let assignments: AssignmentRow[] = [];
let categories: CategoryRow[] = [];
let channels: ChannelRow[] = [];
let invites: InviteRow[] = [];
let bans: BanRow[] = [];
let users: UserRow[] = [];
let createdServer: { roles: { create: RoleRow }; members: { create: { userId: string } } } | null = null;
let createdMembers: { serverId: string; userId: string }[] = [];

const ownerId = 'owner-perms';
const plainId = 'plain-perms';
const serverManagerId = 'server-manager-perms';
const channelManagerId = 'channel-manager-perms';
const inviteManagerId = 'invite-manager-perms';
const kickerId = 'kicker-perms';
const bannerId = 'banner-perms';
const modId = 'mod-perms';
const targetId = 'target-perms';
const outsiderId = 'outsider-perms';
const creatorId = 'creator-perms';
const joinerId = 'joiner-perms';
const serverId = 'server-perms';

const serverSummary = (server: ServerRow) => ({
  id: server.id,
  name: server.name,
  iconVersion: server.iconVersion,
  ownerId: server.ownerId,
  createdAt: server.createdAt,
  channels: channels
    .filter((channel) => channel.serverId === server.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type, categoryId: channel.categoryId, position: channel.position })),
  categories: categories
    .filter((category) => category.serverId === server.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((category) => ({ id: category.id, name: category.name, position: category.position })),
});

const userOf = (id: string) => ({ id, username: id, displayName: null, avatarVersion: null });

const findAccessMember = mock(async ({ where }: { where: { serverId?: string; userId: string } }) => {
  if (where.serverId === undefined) {
    const positions = members.filter((member) => member.userId === where.userId).map((member) => member.position);
    return positions.length > 0 ? { position: Math.max(...positions) } : null;
  }

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
  const { serverId: targetServerId, userId: targetUserId } = where.serverId_userId;
  const member = members.find((entry) => entry.serverId === targetServerId && entry.userId === targetUserId);
  return member ? { id: member.id } : null;
});

const findMembers = mock(async ({ where }: { where: { serverId?: string; userId?: string } }) => {
  if (where.serverId !== undefined) {
    return members.filter((member) => member.serverId === where.serverId).map((member) => ({ userId: member.userId }));
  }

  return members
    .filter((member) => member.userId === where.userId && !bans.some((ban) => ban.serverId === member.serverId && ban.userId === where.userId))
    .map((member) => {
      const server = servers.find((entry) => entry.id === member.serverId)!;
      const defaultRole = roles.find((role) => role.serverId === server.id && role.isDefault);
      const assigned = assignments
        .filter((assignment) => assignment.serverMemberId === member.id)
        .map((assignment) => roles.find((role) => role.id === assignment.roleId))
        .filter((role): role is RoleRow => role !== undefined);

      return {
        position: member.position,
        server: { ...serverSummary(server), roles: defaultRole ? [{ permissions: defaultRole.permissions }] : [] },
        roles: assigned.map((role) => ({ role: { permissions: role.permissions, position: role.position } })),
      };
    });
});

const deleteMember = mock(async ({ where }: { where: { id: string } }) => {
  members = members.filter((member) => member.id !== where.id);
  return { id: where.id };
});

const deleteMembers = mock(async ({ where }: { where: { serverId: string; userId: string } }) => {
  const before = members.length;
  members = members.filter((member) => !(member.serverId === where.serverId && member.userId === where.userId));
  return { count: before - members.length };
});

const countMembers = mock(async ({ where }: { where: { userId: string } }) => members.filter((member) => member.userId === where.userId).length);

const createMember = mock(async ({ data }: { data: { id: string; serverId: string; userId: string; position: number } }) => {
  members.push({ ...data, joinedAt: new Date() });
  servers.find((server) => server.id === data.serverId)?.members.push(data.userId);
  createdMembers.push({ serverId: data.serverId, userId: data.userId });
  return { id: data.id };
});

const findServer = mock(async ({ where }: { where: { id: string; members?: { some: { userId: string } }; bans?: { none: { userId: string } } } }) => {
  const server = servers.find((entry) => entry.id === where.id);
  if (!server) return null;

  if (!where.members) return { id: server.id, name: server.name, iconVersion: server.iconVersion };

  const userId = where.members.some.userId;
  if (!server.members.includes(userId)) return null;
  if (where.bans && bans.some((ban) => ban.serverId === server.id && ban.userId === userId)) return null;

  return {
    ...serverSummary(server),
    roles: roles
      .filter((role) => role.serverId === server.id)
      .sort((a, b) => a.position - b.position)
      .map((role) => ({ ...role })),
    members: members
      .filter((member) => member.serverId === server.id)
      .map((member) => ({
        joinedAt: member.joinedAt,
        user: userOf(member.userId),
        roles: assignments
          .filter((assignment) => assignment.serverMemberId === member.id)
          .map((assignment) => {
            const role = roles.find((entry) => entry.id === assignment.roleId)!;
            return { roleId: role.id, role: { permissions: role.permissions, position: role.position } };
          }),
      })),
  };
});

const createServer = mock(async ({ data }: { data: { id: string; name: string; ownerId: string; roles: { create: RoleRow }; members: { create: { userId: string } } } }) => {
  createdServer = data;
  const server = { id: data.id, name: data.name, ownerId: data.ownerId, iconVersion: null, createdAt: new Date(), members: [data.ownerId] };
  servers.push(server);

  return {
    id: server.id,
    name: server.name,
    iconVersion: null,
    ownerId: server.ownerId,
    createdAt: server.createdAt,
    channels: [{ id: 'created-channel', name: 'general', type: 'TEXT', categoryId: null, position: 0 }],
    categories: [],
  };
});

const updateServer = mock(async ({ where, data }: { where: { id: string }; data: { name: string } }) => {
  const server = servers.find((entry) => entry.id === where.id);
  if (!server) throw new Error('Server not found');
  server.name = data.name;
  return { id: server.id, name: server.name, iconVersion: server.iconVersion };
});

const matchesCategory = (category: CategoryRow, where: { id?: string | { not: string }; serverId?: string; name?: string | { equals: string; mode?: string } }) => {
  if (typeof where.id === 'string' && category.id !== where.id) return false;
  if (typeof where.id === 'object' && category.id === where.id.not) return false;
  if (where.serverId !== undefined && category.serverId !== where.serverId) return false;

  if (where.name !== undefined) {
    const expected = typeof where.name === 'string' ? where.name : where.name.equals;
    const insensitive = typeof where.name === 'object' && where.name.mode === 'insensitive';
    if (insensitive ? category.name.toLowerCase() !== expected.toLowerCase() : category.name !== expected) return false;
  }

  return true;
};

const findCategory = mock(async ({ where }: { where: Parameters<typeof matchesCategory>[1] }) => {
  const category = categories.find((entry) => matchesCategory(entry, where));
  return category ? { id: category.id, name: category.name, position: category.position } : null;
});

const findCategories = mock(async ({ where }: { where: { serverId: string } }) => {
  return categories
    .filter((entry) => entry.serverId === where.serverId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, name: entry.name, position: entry.position }));
});

const countCategories = mock(async ({ where }: { where: { serverId: string } }) => categories.filter((entry) => entry.serverId === where.serverId).length);

const createCategory = mock(async ({ data }: { data: { id: string; serverId: string; name: string; position: number } }) => {
  categories.push({ ...data, createdAt: new Date() });
  return { id: data.id, name: data.name, position: data.position };
});

const updateCategory = mock(async ({ where, data }: { where: { id: string }; data: { name: string } }) => {
  const category = categories.find((entry) => entry.id === where.id);
  if (!category) throw new Error('Category not found');
  category.name = data.name;
  return { id: category.id, name: category.name, position: category.position };
});

const deleteCategory = mock(async ({ where }: { where: { id: string } }) => {
  const category = categories.find((entry) => entry.id === where.id);
  categories = categories.filter((entry) => entry.id !== where.id);
  return category;
});

const findChannel = mock(async ({ where }: { where: { id?: string | { not: string }; serverId?: string; name?: string } }) => {
  const channel = channels.find((entry) => {
    if (where.serverId !== undefined && entry.serverId !== where.serverId) return false;
    if (typeof where.id === 'string' && entry.id !== where.id) return false;
    if (typeof where.id === 'object' && entry.id === where.id.not) return false;
    if (where.name !== undefined && entry.name !== where.name) return false;
    return true;
  });

  return channel ? { id: channel.id, name: channel.name, type: channel.type, categoryId: channel.categoryId, position: channel.position } : null;
});

const findChannels = mock(async ({ where }: { where: { serverId: string; categoryId?: string | null } }) => {
  return channels
    .filter((entry) => entry.serverId === where.serverId && (where.categoryId === undefined || entry.categoryId === where.categoryId))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, name: entry.name, type: entry.type, categoryId: entry.categoryId, position: entry.position }));
});

const countChannels = mock(async ({ where }: { where: { serverId: string } }) => channels.filter((entry) => entry.serverId === where.serverId).length);

const createChannel = mock(async ({ data }: { data: { id: string; serverId: string; name: string; type: 'TEXT'; categoryId: string | null; position: number } }) => {
  channels.push({ ...data, createdAt: new Date() });
  return { id: data.id, name: data.name, type: data.type, categoryId: data.categoryId, position: data.position };
});

const updateChannel = mock(async ({ where, data }: { where: { id: string }; data: { name?: string; categoryId?: string | null; position?: number } }) => {
  const channel = channels.find((entry) => entry.id === where.id);
  if (!channel) throw new Error('Channel not found');
  if (data.name !== undefined) channel.name = data.name;
  if (data.categoryId !== undefined) channel.categoryId = data.categoryId;
  if (data.position !== undefined) channel.position = data.position;
  return channel;
});

const findInvite = mock(async ({ where }: { where: { code: string } }) => {
  const invite = invites.find((entry) => entry.code === where.code);
  if (!invite) return null;

  const server = servers.find((entry) => entry.id === invite.serverId);
  if (!server) return null;

  const channel = invite.channelId ? channels.find((entry) => entry.id === invite.channelId) : null;
  const defaultRole = roles.find((role) => role.serverId === server.id && role.isDefault);

  return {
    id: invite.id,
    serverId: invite.serverId,
    expiresAt: invite.expiresAt,
    channelId: invite.channelId,
    channel: channel ? { id: channel.id, serverId: channel.serverId } : null,
    server: { ...serverSummary(server), roles: defaultRole ? [{ permissions: defaultRole.permissions }] : [] },
  };
});

const listInvites = mock(async ({ where }: { where: { serverId: string; expiresAt: { gt: Date } } }) => {
  return invites
    .filter((invite) => invite.serverId === where.serverId && invite.expiresAt.getTime() > where.expiresAt.gt.getTime())
    .map((invite) => ({
      code: invite.code,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      channel: invite.channelId ? { id: invite.channelId, name: channels.find((channel) => channel.id === invite.channelId)?.name ?? 'gone' } : null,
      createdBy: userOf(invite.createdById),
    }));
});

const deleteInvite = mock(async ({ where }: { where: { id: string } }) => {
  invites = invites.filter((entry) => entry.id !== where.id);
  return { id: where.id };
});

const deleteInvites = mock(async ({ where }: { where: { serverId: string; createdById: string } }) => {
  const before = invites.length;
  invites = invites.filter((invite) => !(invite.serverId === where.serverId && invite.createdById === where.createdById));
  return { count: before - invites.length };
});

const findBan = mock(async ({ where }: { where: { serverId_userId: { serverId: string; userId: string } } }) => {
  const { serverId: targetServerId, userId: targetUserId } = where.serverId_userId;
  return bans.find((ban) => ban.serverId === targetServerId && ban.userId === targetUserId) ?? null;
});

const listBans = mock(async ({ where }: { where: { serverId: string } }) => {
  return bans.filter((ban) => ban.serverId === where.serverId).map((ban) => ({ reason: ban.reason, createdAt: ban.createdAt, user: userOf(ban.userId), bannedBy: userOf(ban.bannedById) }));
});

const upsertBan = mock(
  async ({ where, create, update }: { where: { serverId_userId: { serverId: string; userId: string } }; create: BanRow; update: { bannedById: string; reason: string | null } }) => {
    const { serverId: targetServerId, userId: targetUserId } = where.serverId_userId;
    const existing = bans.find((ban) => ban.serverId === targetServerId && ban.userId === targetUserId);

    if (existing) {
      existing.bannedById = update.bannedById;
      existing.reason = update.reason;
      return { id: existing.id };
    }

    bans.push({ ...create, createdAt: new Date() });
    return { id: create.id };
  },
);

const deleteBan = mock(async ({ where }: { where: { id: string } }) => {
  bans = bans.filter((ban) => ban.id !== where.id);
  return { id: where.id };
});

const findUser = mock(async ({ where }: { where: { id: string } }) => users.find((user) => user.id === where.id) ?? null);

const transaction = async (operations: Promise<unknown>[]) => Promise.all(operations);

mock.module('../db', () => ({
  prisma: {
    server: { findFirst: findServer, create: createServer, update: updateServer },
    serverMember: {
      findFirst: findAccessMember,
      findUnique: findMember,
      findMany: findMembers,
      count: countMembers,
      create: createMember,
      delete: deleteMember,
      deleteMany: deleteMembers,
    },
    channelCategory: {
      findFirst: findCategory,
      findMany: findCategories,
      count: countCategories,
      create: createCategory,
      update: updateCategory,
      delete: deleteCategory,
    },
    channel: {
      findFirst: findChannel,
      findMany: findChannels,
      count: countChannels,
      create: createChannel,
      update: updateChannel,
    },
    serverInvite: {
      findUnique: findInvite,
      findMany: listInvites,
      delete: deleteInvite,
      deleteMany: deleteInvites,
    },
    serverBan: { findUnique: findBan, findMany: listBans, upsert: upsertBan, delete: deleteBan },
    user: { findUnique: findUser },
    $transaction: transaction,
  },
}));

const { default: serversRoute } = await import('./servers');
const { ALL_PERMISSIONS, PERMISSIONS } = await import('../services/permissions');

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

const addRole = (data: { name: string; position: number; permissions: number; color?: number | null; isDefault?: boolean }) => {
  const role: RoleRow = {
    id: `role-${data.name}`,
    serverId,
    name: data.name,
    color: data.color ?? null,
    permissions: data.permissions,
    position: data.position,
    isDefault: data.isDefault ?? false,
    createdAt: new Date(),
  };

  roles.push(role);
  return role;
};

const addMember = (userId: string, position: number) => {
  const member: MemberRow = { id: `member-${userId}`, serverId, userId, position, joinedAt: new Date(2026, 0, 1 + position) };
  members.push(member);
  servers[0]!.members.push(userId);
  return member;
};

const assign = (userId: string, role: RoleRow) => {
  const member = members.find((entry) => entry.userId === userId)!;
  assignments.push({ id: `assignment-${userId}`, roleId: role.id, serverMemberId: member.id });
};

let viewAuditRole: RoleRow;
let serverRole: RoleRow;
let channelRole: RoleRow;
let inviteRole: RoleRow;
let kickRole: RoleRow;
let banRole: RoleRow;
let modRole: RoleRow;

const seed = () => {
  servers = [{ id: serverId, name: 'Perms', ownerId, iconVersion: null, createdAt: new Date('2026-01-01T00:00:00Z'), members: [] }];
  roles = [];
  members = [];
  assignments = [];
  categories = [{ id: 'category-p', serverId, name: 'Projects', position: 0, createdAt: new Date() }];
  channels = [{ id: 'channel-p', serverId, name: 'general', type: 'TEXT', categoryId: null, position: 0, createdAt: new Date() }];
  invites = [{ id: 'invite-p', code: 'code-p', serverId, channelId: null, createdById: ownerId, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }];
  bans = [];
  users = [
    { id: ownerId },
    { id: plainId },
    { id: serverManagerId },
    { id: channelManagerId },
    { id: inviteManagerId },
    { id: kickerId },
    { id: bannerId },
    { id: modId },
    { id: targetId },
    { id: outsiderId },
    { id: creatorId },
    { id: joinerId },
  ];
  createdServer = null;
  createdMembers = [];

  addRole({ name: '@everyone', position: 0, permissions: 0, isDefault: true });
  viewAuditRole = addRole({ name: 'View Audit', position: 1, permissions: PERMISSIONS.VIEW_AUDIT_LOG });
  serverRole = addRole({ name: 'Server Manager', position: 2, permissions: PERMISSIONS.MANAGE_SERVER });
  channelRole = addRole({ name: 'Channel Manager', position: 3, permissions: PERMISSIONS.MANAGE_CHANNELS });
  inviteRole = addRole({ name: 'Invite Manager', position: 4, permissions: PERMISSIONS.MANAGE_INVITES });
  kickRole = addRole({ name: 'Kicker', position: 5, permissions: PERMISSIONS.KICK_MEMBERS });
  banRole = addRole({ name: 'Banner', position: 6, permissions: PERMISSIONS.BAN_MEMBERS });
  modRole = addRole({ name: 'Moderator', position: 7, permissions: PERMISSIONS.MANAGE_ROLES | PERMISSIONS.KICK_MEMBERS, color: 0x336699 });

  addMember(ownerId, 0);
  addMember(plainId, 1);
  addMember(serverManagerId, 2);
  addMember(channelManagerId, 3);
  addMember(inviteManagerId, 4);
  addMember(kickerId, 5);
  addMember(bannerId, 6);
  addMember(modId, 7);
  addMember(targetId, 8);

  assign(plainId, viewAuditRole);
  assign(serverManagerId, serverRole);
  assign(channelManagerId, channelRole);
  assign(inviteManagerId, inviteRole);
  assign(kickerId, kickRole);
  assign(bannerId, banRole);
  assign(modId, modRole);
};

beforeEach(seed);

afterAll(() => mock.restore());

const call = (app: Hono<{ Variables: Variables }>, method: string, path: string, body?: unknown) =>
  app.request(`/servers${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const get = (app: Hono<{ Variables: Variables }>, path: string) => call(app, 'GET', path);

type RouteCase = {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  bit: number;
  allowed: string;
  success: number;
  setup?: () => void;
};

const routes: RouteCase[] = [
  { name: 'rename server', method: 'PATCH', path: `/${serverId}`, body: { name: 'Renamed' }, bit: PERMISSIONS.MANAGE_SERVER, allowed: serverManagerId, success: 200 },
  {
    name: 'reorder layout',
    method: 'PUT',
    path: `/${serverId}/layout`,
    body: {
      categories: ['category-p'],
      groups: [
        { categoryId: null, channelIds: ['channel-p'] },
        { categoryId: 'category-p', channelIds: [] },
      ],
    },
    bit: PERMISSIONS.MANAGE_CHANNELS,
    allowed: channelManagerId,
    success: 200,
  },
  { name: 'create category', method: 'POST', path: `/${serverId}/categories`, body: { name: 'New Category' }, bit: PERMISSIONS.MANAGE_CHANNELS, allowed: channelManagerId, success: 201 },
  {
    name: 'rename category',
    method: 'PATCH',
    path: `/${serverId}/categories/category-p`,
    body: { name: 'Renamed Category' },
    bit: PERMISSIONS.MANAGE_CHANNELS,
    allowed: channelManagerId,
    success: 200,
  },
  { name: 'delete category', method: 'DELETE', path: `/${serverId}/categories/category-p`, bit: PERMISSIONS.MANAGE_CHANNELS, allowed: channelManagerId, success: 204 },
  { name: 'create channel', method: 'POST', path: `/${serverId}/channels`, body: { name: 'new-channel' }, bit: PERMISSIONS.MANAGE_CHANNELS, allowed: channelManagerId, success: 201 },
  {
    name: 'rename channel',
    method: 'PATCH',
    path: `/${serverId}/channels/channel-p`,
    body: { name: 'renamed-channel' },
    bit: PERMISSIONS.MANAGE_CHANNELS,
    allowed: channelManagerId,
    success: 200,
  },
  { name: 'list invites', method: 'GET', path: `/${serverId}/invites`, bit: PERMISSIONS.MANAGE_INVITES, allowed: inviteManagerId, success: 200 },
  { name: 'revoke invite', method: 'DELETE', path: `/${serverId}/invites/code-p`, bit: PERMISSIONS.MANAGE_INVITES, allowed: inviteManagerId, success: 204 },
  { name: 'kick member', method: 'DELETE', path: `/${serverId}/members/${targetId}`, bit: PERMISSIONS.KICK_MEMBERS, allowed: kickerId, success: 204 },
  { name: 'ban member', method: 'PUT', path: `/${serverId}/bans/${targetId}`, body: {}, bit: PERMISSIONS.BAN_MEMBERS, allowed: bannerId, success: 204 },
  {
    name: 'unban member',
    method: 'DELETE',
    path: `/${serverId}/bans/${targetId}`,
    bit: PERMISSIONS.BAN_MEMBERS,
    allowed: bannerId,
    success: 204,
    setup: () => bans.push({ id: 'ban-target', serverId, userId: targetId, bannedById: ownerId, reason: null, createdAt: new Date() }),
  },
  { name: 'list bans', method: 'GET', path: `/${serverId}/bans`, bit: PERMISSIONS.BAN_MEMBERS, allowed: bannerId, success: 200 },
];

for (const route of routes) {
  test(`${route.name}: owner is allowed`, async () => {
    route.setup?.();
    const response = await call(createApp(ownerId), route.method, route.path, route.body);
    expect(response.status).toBe(route.success);
  });

  test(`${route.name}: a role with the permission is allowed`, async () => {
    route.setup?.();
    const response = await call(createApp(route.allowed), route.method, route.path, route.body);
    expect(response.status).toBe(route.success);
  });

  test(`${route.name}: a role without the permission is rejected`, async () => {
    const response = await call(createApp(plainId), route.method, route.path, route.body);
    expect(response.status).toBe(403);
  });

  test(`${route.name}: a non-member gets 404`, async () => {
    const response = await call(createApp(outsiderId), route.method, route.path, route.body);
    expect(response.status).toBe(404);
  });
}

test('a kicker cannot kick a higher-ranked member', async () => {
  const response = await call(createApp(kickerId), 'DELETE', `/${serverId}/members/${bannerId}`);
  expect(response.status).toBe(403);
});

test('a kicker can kick a lower-ranked member with a role', async () => {
  const response = await call(createApp(kickerId), 'DELETE', `/${serverId}/members/${plainId}`);
  expect(response.status).toBe(204);
});

test('a member cannot kick someone at their own rank', async () => {
  addMember('peer-kicker', 9);
  assign('peer-kicker', kickRole);

  const response = await call(createApp(kickerId), 'DELETE', `/${serverId}/members/peer-kicker`);
  expect(response.status).toBe(403);
});

test('the owner bypasses the kick hierarchy', async () => {
  const response = await call(createApp(ownerId), 'DELETE', `/${serverId}/members/${modId}`);
  expect(response.status).toBe(204);
});

test('a banner cannot ban a higher-ranked member', async () => {
  const response = await call(createApp(bannerId), 'PUT', `/${serverId}/bans/${modId}`, {});
  expect(response.status).toBe(403);
});

test('a roleless actor with KICK_MEMBERS can kick a roleless target', async () => {
  roles.find((role) => role.isDefault)!.permissions = PERMISSIONS.KICK_MEMBERS;
  addMember('roleless-kicker', 9);

  const response = await call(createApp('roleless-kicker'), 'DELETE', `/${serverId}/members/${targetId}`);
  expect(response.status).toBe(204);
});

test('KICK_MEMBERS does not grant BAN_MEMBERS', async () => {
  const response = await call(createApp(kickerId), 'PUT', `/${serverId}/bans/${targetId}`, {});
  expect(response.status).toBe(403);
});

test('detail hides role permissions from members without MANAGE_ROLES', async () => {
  const response = await get(createApp(plainId), `/${serverId}`);
  const body = (await response.json()) as {
    myPermissions: number;
    myHighestRolePosition: number;
    roles: { id: string; permissions: number }[];
    members: { id: string; roleIds: string[] }[];
  };

  expect(response.status).toBe(200);
  expect(body.myPermissions).toBe(PERMISSIONS.VIEW_AUDIT_LOG);
  expect(body.myHighestRolePosition).toBe(1);
  expect(body.roles).toHaveLength(8);
  expect(body.roles.every((role) => role.permissions === 0)).toBe(true);
  expect(body.members.find((member) => member.id === plainId)?.roleIds).toEqual([viewAuditRole.id]);
});

test('detail returns role permissions to MANAGE_ROLES members', async () => {
  const response = await get(createApp(modId), `/${serverId}`);
  const body = (await response.json()) as { myPermissions: number; myHighestRolePosition: number; roles: { id: string; permissions: number }[] };

  expect(body.myPermissions).toBe(PERMISSIONS.MANAGE_ROLES | PERMISSIONS.KICK_MEMBERS);
  expect(body.myHighestRolePosition).toBe(7);
  expect(body.roles.find((role) => role.id === banRole.id)?.permissions).toBe(PERMISSIONS.BAN_MEMBERS);
  expect(body.roles.find((role) => role.id === modRole.id)?.permissions).toBe(PERMISSIONS.MANAGE_ROLES | PERMISSIONS.KICK_MEMBERS);
});

test('detail returns every role permission to the owner', async () => {
  const response = await get(createApp(ownerId), `/${serverId}`);
  const body = (await response.json()) as { myPermissions: number; myHighestRolePosition: number; roles: { id: string; permissions: number }[] };

  expect(body.myPermissions).toBe(ALL_PERMISSIONS);
  expect(body.myHighestRolePosition).toBe(1_000_000);
  expect(body.roles.find((role) => role.id === banRole.id)?.permissions).toBe(PERMISSIONS.BAN_MEMBERS);
});

test('detail is hidden from non-members', async () => {
  expect((await get(createApp(outsiderId), `/${serverId}`)).status).toBe(404);
});

test('list returns the default role bits and highest position for a plain member', async () => {
  const response = await get(createApp(plainId), '');
  const body = (await response.json()) as { myPermissions: number; myHighestRolePosition: number; roles?: unknown }[];

  expect(body).toHaveLength(1);
  expect(body[0]?.myPermissions).toBe(PERMISSIONS.VIEW_AUDIT_LOG);
  expect(body[0]?.myHighestRolePosition).toBe(1);
  expect(body[0]).not.toHaveProperty('roles');
});

test('list unions the default role with assigned roles', async () => {
  roles.find((role) => role.isDefault)!.permissions = PERMISSIONS.MANAGE_INVITES;

  const response = await get(createApp(modId), '');
  const body = (await response.json()) as { myPermissions: number; myHighestRolePosition: number }[];

  expect(body[0]?.myPermissions).toBe(PERMISSIONS.MANAGE_INVITES | PERMISSIONS.MANAGE_ROLES | PERMISSIONS.KICK_MEMBERS);
  expect(body[0]?.myHighestRolePosition).toBe(7);
});

test('list gives the owner every permission', async () => {
  const response = await get(createApp(ownerId), '');
  const body = (await response.json()) as { myPermissions: number; myHighestRolePosition: number }[];

  expect(body[0]?.myPermissions).toBe(ALL_PERMISSIONS);
  expect(body[0]?.myHighestRolePosition).toBe(1_000_000);
});

test('list is empty for a non-member', async () => {
  expect(await (await get(createApp(outsiderId), '')).json()).toEqual([]);
});

test('create makes the default role in the same write and returns owner access', async () => {
  const response = await call(createApp(creatorId), 'POST', '/create', { name: 'Created' });
  const body = (await response.json()) as { myPermissions: number; myHighestRolePosition: number };

  expect(response.status).toBe(201);
  expect(createdServer?.roles.create).toMatchObject({ name: '@everyone', position: 0, isDefault: true });
  expect(createdServer?.members.create).toMatchObject({ userId: creatorId });
  expect(body.myPermissions).toBe(ALL_PERMISSIONS);
  expect(body.myHighestRolePosition).toBe(1_000_000);
});

test('join returns the default role bits and highest 0', async () => {
  roles.find((role) => role.isDefault)!.permissions = PERMISSIONS.MANAGE_INVITES;

  const response = await call(createApp(joinerId), 'POST', '/join', { code: 'code-p' });
  const body = (await response.json()) as { myPermissions: number; myHighestRolePosition: number; roles?: unknown };

  expect(response.status).toBe(201);
  expect(body.myPermissions).toBe(PERMISSIONS.MANAGE_INVITES);
  expect(body.myHighestRolePosition).toBe(0);
  expect(body).not.toHaveProperty('roles');
  expect(createdMembers).toEqual([{ serverId, userId: joinerId }]);
});
