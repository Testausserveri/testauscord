'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { banMember, getUser, removeMember, updateMemberRoles } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { roleColorHex } from '@/lib/roles';
import type { CurrentUser, Server, ServerDetail, ServerMember, ServerRole } from '@/types/types';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useProfilePopover } from '@/components/ProfilePopoverProvider';

type Props = {
  server: Server;
  detail: ServerDetail;
};

export function MembersTab({ server, detail }: Props) {
  const queryClient = useQueryClient();
  const { openProfile } = useProfilePopover();
  const { data: user } = useQuery<CurrentUser>({ queryKey: ['user'], queryFn: getUser, staleTime: Infinity });
  const [search, setSearch] = useState('');
  const [roleEditor, setRoleEditor] = useState<{ memberId: string; roleIds: string[] } | null>(null);
  const [moderation, setModeration] = useState<{ kind: 'kick' | 'ban'; member: ServerMember } | null>(null);
  const [banReason, setBanReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewerIsOwner = Boolean(user && server.ownerId === user.id);
  const canManageRoles = hasPermission(server, PERMISSIONS.MANAGE_ROLES);
  const canKick = hasPermission(server, PERMISSIONS.KICK_MEMBERS);
  const canBan = hasPermission(server, PERMISSIONS.BAN_MEMBERS);
  const rolesById = new Map(detail.roles.map((role) => [role.id, role]));
  const assignableRoles = detail.roles.filter((role) => !role.isDefault && (viewerIsOwner || (role.position < server.myHighestRolePosition && (role.permissions & ~server.myPermissions) === 0)));
  const assignableRoleIds = new Set(assignableRoles.map((role) => role.id));
  const roleOptions = detail.roles.filter((role) => !role.isDefault).sort((a, b) => b.position - a.position);

  const query = search.trim().toLowerCase();
  const members = detail.members.filter((member) => !query || (member.displayName ?? '').toLowerCase().includes(query) || member.username.toLowerCase().includes(query));

  const highestPosition = (member: ServerMember) => member.roleIds.reduce((highest, id) => Math.max(highest, rolesById.get(id)?.position ?? 0), 0);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['server', server.id] });

  const openRoles = (member: ServerMember) => {
    setError(null);
    setRoleEditor({ memberId: member.id, roleIds: member.roleIds });
  };

  const toggleRole = (roleId: string, checked: boolean) => {
    setRoleEditor((current) => {
      if (!current) return current;
      return { ...current, roleIds: checked ? [...current.roleIds, roleId] : current.roleIds.filter((id) => id !== roleId) };
    });
  };

  const saveRoles = async () => {
    if (!roleEditor || busy) return;

    setBusy(true);
    setError(null);
    try {
      await updateMemberRoles(server.id, roleEditor.memberId, roleEditor.roleIds);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      setRoleEditor(null);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const openModeration = (kind: 'kick' | 'ban', member: ServerMember) => {
    setError(null);
    setBanReason('');
    setModeration({ kind, member });
  };

  const closeModeration = () => {
    setModeration(null);
    setBanReason('');
    setError(null);
  };

  const confirmModeration = async () => {
    if (!moderation || busy) return;

    setBusy(true);
    setError(null);
    try {
      if (moderation.kind === 'kick') {
        await removeMember(server.id, moderation.member.id);
      } else {
        await banMember(server.id, moderation.member.id, banReason.trim() || undefined);
      }
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['server-bans', server.id] });
      closeModeration();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search members" aria-label="Search members" />

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{detail.members.length === 0 ? 'No members.' : 'No members match your search.'}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {members.map((member) => {
            const memberRoles = member.roleIds
              .map((id) => rolesById.get(id))
              .filter((role): role is ServerRole => Boolean(role && !role.isDefault))
              .sort((a, b) => b.position - a.position);
            const targetIsOwner = member.id === server.ownerId;
            const outranks = highestPosition(member) < server.myHighestRolePosition;
            const showActions = !targetIsOwner && outranks;
            const isEditing = roleEditor?.memberId === member.id;
            const hasUnmanageableRoles = member.roleIds.some((id) => {
              const role = rolesById.get(id);
              return Boolean(role && !role.isDefault && !assignableRoleIds.has(id));
            });

            return (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                <button
                  type="button"
                  onClick={(event) => openProfile(member.id, event.currentTarget)}
                  title="View profile"
                  className="flex min-w-0 items-center gap-2 rounded-sm text-left hover:underline"
                >
                  <UserAvatar user={member} className="size-8" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{member.displayName ?? member.username}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {member.displayName ? `@${member.username} · ` : ''}Joined {new Date(member.joinedAt).toLocaleDateString()}
                    </span>
                  </span>
                </button>

                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {memberRoles.map((role) => (
                    <span key={role.id} className="rounded bg-muted px-1.5 py-0.5 text-xs" style={role.color != null ? { color: roleColorHex(role.color) } : undefined}>
                      {role.name}
                    </span>
                  ))}
                  {targetIsOwner && <span className="text-xs text-muted-foreground">Owner</span>}
                </div>

                {showActions && (canManageRoles || canKick || canBan) && (
                  <div className="flex shrink-0 items-center gap-1">
                    {canManageRoles && (
                      <Popover open={isEditing} onOpenChange={(open) => (open ? openRoles(member) : setRoleEditor(null))}>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="secondary" size="sm">
                            Roles
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-64">
                          {assignableRoles.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No assignable roles.</p>
                          ) : (
                            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                              {roleOptions.map((role) => {
                                const assignable = assignableRoleIds.has(role.id);
                                return (
                                  <div key={role.id} className="flex items-center gap-2">
                                    <Checkbox
                                      id={`member-role-${member.id}-${role.id}`}
                                      checked={roleEditor?.roleIds.includes(role.id) ?? false}
                                      onCheckedChange={(checked) => toggleRole(role.id, checked === true)}
                                      disabled={busy || !assignable}
                                    />
                                    <Label htmlFor={`member-role-${member.id}-${role.id}`} className="text-sm font-normal">
                                      <span style={role.color != null ? { color: roleColorHex(role.color) } : undefined}>{role.name}</span>
                                    </Label>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {hasUnmanageableRoles && <p className="mt-2 text-xs text-muted-foreground">This member has roles you cannot manage.</p>}
                          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
                          <div className="mt-3 flex justify-end">
                            <Button type="button" size="sm" onClick={saveRoles} disabled={busy || assignableRoles.length === 0 || hasUnmanageableRoles}>
                              Save
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {canKick && (
                      <Button type="button" variant="secondary" size="sm" onClick={() => openModeration('kick', member)} disabled={busy}>
                        Kick
                      </Button>
                    )}
                    {canBan && (
                      <Button type="button" variant="destructive" size="sm" onClick={() => openModeration('ban', member)} disabled={busy}>
                        Ban
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={moderation !== null} onOpenChange={(open) => !open && closeModeration()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moderation?.kind === 'ban' ? 'Ban' : 'Kick'} <b>{moderation?.member.displayName ?? moderation?.member.username}</b>?
            </DialogTitle>
            <DialogDescription>
              {moderation?.kind === 'ban' ? `They lose access to ${server.name} and cannot rejoin until you unban them.` : `They lose access to ${server.name} until they join with a new invite.`}
            </DialogDescription>
          </DialogHeader>
          {moderation?.kind === 'ban' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ban-reason">Reason (optional)</Label>
              <Input id="ban-reason" value={banReason} onChange={(event) => setBanReason(event.target.value)} maxLength={200} placeholder="Why they were banned" disabled={busy} />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeModeration}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmModeration} disabled={busy}>
              {moderation?.kind === 'ban' ? 'Ban' : 'Kick'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
