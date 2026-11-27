'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { createRole, deleteRole, getUser, reorderRoles, updateRole } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { moveRoleOrder, parseRoleColor, roleColorHex } from '@/lib/roles';
import { cn } from '@/lib/utils';
import type { CurrentUser, RolePatch, Server, ServerRole } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MAX_ROLES = 25;

const PERMISSION_GROUPS = [
  {
    label: 'Server',
    items: [
      { bit: PERMISSIONS.MANAGE_SERVER, label: 'Manage server' },
      { bit: PERMISSIONS.MANAGE_ROLES, label: 'Manage roles' },
      { bit: PERMISSIONS.MANAGE_CHANNELS, label: 'Manage channels' },
      { bit: PERMISSIONS.MANAGE_INVITES, label: 'Manage invites' },
      { bit: PERMISSIONS.VIEW_AUDIT_LOG, label: 'View audit log' },
    ],
  },
  {
    label: 'Membership',
    items: [
      { bit: PERMISSIONS.KICK_MEMBERS, label: 'Kick members' },
      { bit: PERMISSIONS.BAN_MEMBERS, label: 'Ban members' },
    ],
  },
];

const COLORS = [0x1abc9c, 0x2ecc71, 0x3498db, 0x9b59b6, 0xe91e63, 0xf1c40f, 0xe67e22, 0xe74c3c, 0x95a5a6, 0x607d8b];

export function RolesTab({ server, roles }: { server: Server; roles: ServerRole[] }) {
  const queryClient = useQueryClient();
  const { data: user } = useQuery<CurrentUser>({ queryKey: ['user'], queryFn: getUser, staleTime: Infinity });
  const isOwner = Boolean(user && server.ownerId === user.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = [...roles].sort((a, b) => b.position - a.position);
  const selected = ordered.find((role) => role.id === selectedId) ?? ordered[0] ?? null;
  const atLimit = roles.length >= MAX_ROLES;
  const canCreate = (isOwner || server.myHighestRolePosition > 0) && !atLimit;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
    await queryClient.invalidateQueries({ queryKey: ['servers'] });
  };

  const handleCreate = async () => {
    if (!canCreate || busy) return;

    setBusy(true);
    setError(null);
    try {
      const used = new Set(roles.map((role) => role.name.toLowerCase()));
      let name = 'new role';
      for (let index = 2; used.has(name); index += 1) name = `new role ${index}`;

      const created = await createRole(server.id, name);
      setSelectedId(created.id);
      await refresh();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4 md:flex-row md:gap-6">
      <div className="flex w-full shrink-0 flex-col gap-2 md:w-48">
        <Button type="button" size="sm" onClick={handleCreate} disabled={!canCreate || busy}>
          Create role
        </Button>

        <div className="flex flex-col gap-0.5">
          {ordered.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted', selected?.id === role.id && 'bg-muted')}
            >
              <span
                className={cn('size-2.5 shrink-0 rounded-full border', role.color == null && 'border-muted-foreground/40')}
                style={role.color != null ? { backgroundColor: roleColorHex(role.color) } : undefined}
              />
              <span className="truncate">{role.name}</span>
            </button>
          ))}
        </div>

        {!canCreate && <p className="text-xs text-muted-foreground">{atLimit ? 'This server has reached the role limit.' : 'You cannot create roles.'}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {selected && <RoleEditor key={selected.id} server={server} role={selected} roles={ordered} isOwner={isOwner} onDeleted={() => setSelectedId(null)} onRefresh={refresh} />}
    </div>
  );
}

type EditorProps = {
  server: Server;
  role: ServerRole;
  roles: ServerRole[];
  isOwner: boolean;
  onDeleted: () => void;
  onRefresh: () => Promise<void>;
};

function RoleEditor({ server, role, roles, isOwner, onDeleted, onRefresh }: EditorProps) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color == null ? '' : roleColorHex(role.color));
  const [permissions, setPermissions] = useState(role.permissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const locked = !isOwner && (role.isDefault || role.position >= server.myHighestRolePosition);
  const parsedColor = parseRoleColor(color);
  const colorInvalid = parsedColor === undefined;
  const trimmed = name.trim();
  const changed = trimmed !== role.name || parsedColor !== role.color || permissions !== role.permissions;
  const canSave = !locked && trimmed.length > 0 && !colorInvalid && changed;

  const movableRoles = roles.filter((entry) => !entry.isDefault);
  const index = movableRoles.findIndex((entry) => entry.id === role.id);
  const movable = !role.isDefault && !locked && index >= 0;
  const canMoveUp = movable && index > 0 && (isOwner || movableRoles[index - 1].position < server.myHighestRolePosition);
  const canMoveDown = movable && index < movableRoles.length - 1;

  const handleMove = async (direction: -1 | 1) => {
    if (busy || !movable) return;

    const order = moveRoleOrder(roles, role.id, direction);
    if (!order) return;

    setBusy(true);
    setError(null);
    try {
      await reorderRoles(server.id, order);
      await onRefresh();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || busy) return;

    const patch: RolePatch = {};
    if (trimmed !== role.name) patch.name = trimmed;
    if (parsedColor !== role.color) patch.color = parsedColor;
    if (permissions !== role.permissions) patch.permissions = permissions;

    setBusy(true);
    setError(null);
    try {
      await updateRole(server.id, role.id, patch);
      await onRefresh();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await deleteRole(server.id, role.id);
      setConfirmingDelete(false);
      onDeleted();
      await onRefresh();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSave} className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label htmlFor="role-name">Role name</Label>
            <Input id="role-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} disabled={busy || locked || role.isDefault} />
          </div>
          <Button type="button" variant="outline" size="icon" onClick={() => handleMove(-1)} disabled={!canMoveUp || busy} title="Move up" aria-label="Move role up">
            <ArrowUp />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => handleMove(1)} disabled={!canMoveDown || busy} title="Move down" aria-label="Move role down">
            <ArrowDown />
          </Button>
        </div>

        {locked && <p className="text-xs text-muted-foreground">{role.isDefault ? 'Only the server owner can edit @everyone.' : 'You cannot edit a role at or above your highest role.'}</p>}

        <div className="flex flex-col gap-2">
          <Label htmlFor="role-color">Color</Label>
          <div className="flex flex-wrap items-center gap-2">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setColor(roleColorHex(value))}
                disabled={busy || locked}
                title={roleColorHex(value)}
                aria-label={`Use color ${roleColorHex(value)}`}
                className={cn('size-6 rounded-full border', parsedColor === value && 'ring-2 ring-ring ring-offset-2 ring-offset-background')}
                style={{ backgroundColor: roleColorHex(value) }}
              />
            ))}
            <Input id="role-color" value={color} onChange={(event) => setColor(event.target.value)} placeholder="#5865f2" maxLength={7} disabled={busy || locked} className="w-28 font-mono" />
          </div>
          {colorInvalid && <p className="text-xs text-destructive">Use a 6 digit hex color, or leave it empty for no color.</p>}
        </div>

        {PERMISSION_GROUPS.map((group) => (
          <fieldset key={group.label} className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</legend>
            {group.items.map((item) => (
              <div key={item.bit} className="flex items-center gap-2">
                <Checkbox
                  id={`role-permission-${item.bit}`}
                  checked={(permissions & item.bit) === item.bit}
                  onCheckedChange={(checked) => setPermissions((current) => (checked === true ? current | item.bit : current & ~item.bit))}
                  disabled={busy || locked || !hasPermission(server, item.bit)}
                />
                <Label htmlFor={`role-permission-${item.bit}`} className="text-sm font-normal">
                  {item.label}
                </Label>
              </div>
            ))}
          </fieldset>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)} disabled={busy || locked || role.isDefault}>
            Delete
          </Button>
          <Button type="submit" disabled={!canSave || busy}>
            Save changes
          </Button>
        </div>
      </form>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {role.name}?</DialogTitle>
            <DialogDescription>Members with this role lose its permissions.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={busy}>
              Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
