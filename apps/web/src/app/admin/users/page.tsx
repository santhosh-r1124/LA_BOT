'use client';

import type { AuthUser } from '@legal-platform/auth';
import { useCallback, useEffect, useState } from 'react';
import { Pager, SelectFilter } from '@/components/admin';
import { EmptyState, ErrorState, StatusBadge } from '@/components/ui';
import { adminClient, type Paginated } from '@/lib/admin-client';
import { ApiRequestError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const ROLES = ['CONSUMER', 'ADVOCATE', 'ADMIN', 'LEGAL_ADMIN', 'ENTERPRISE_USER'] as const;

export default function AdminUsersPage() {
  const { user: me, accessToken } = useAuth();
  const [role, setRole] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paginated<AuthUser> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accessToken) return;
    setError(null);
    adminClient
      .users(accessToken, { role: role || undefined, offset })
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load users.'),
      );
  }, [accessToken, role, offset]);

  useEffect(() => load(), [load]);

  async function toggle(user: AuthUser) {
    if (!accessToken) return;
    const verb = user.is_active ? 'Suspend' : 'Reactivate';
    if (!window.confirm(`${verb} ${user.email}?`)) return;
    setBusyId(user.id);
    try {
      await adminClient.setUserActive(accessToken, user.id, !user.is_active);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : `${verb} failed.`);
    } finally {
      setBusyId(null);
      load();
    }
  }

  return (
    <section aria-labelledby="users-heading">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="users-heading" className="display mb-1 text-2xl">
            Users
          </h1>
          <p className="muted text-sm">
            Suspended accounts are signed out on their next request and can&apos;t sign in.
          </p>
        </div>
        <SelectFilter
          label="Role"
          value={role}
          options={ROLES}
          onChange={(v) => {
            setRole(v);
            setOffset(0);
          }}
        />
      </div>
      {error && <ErrorState title="Users error" message={error} onRetry={load} />}
      {!data ? (
        <div className="skeleton h-40" />
      ) : data.items.length === 0 ? (
        <EmptyState title="No users match" />
      ) : (
        <>
          <ul className="surface flex flex-col divide-y divide-white/5">
            {data.items.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.display_name || u.email}</p>
                  <p className="subtle truncate text-xs">
                    {u.email} · {u.role.replace('_', ' ')}
                    {u.email_verified ? '' : ' · email unverified'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={u.is_active ? 'ok' : 'danger'}>
                    {u.is_active ? 'Active' : 'Suspended'}
                  </StatusBadge>
                  {u.id !== me?.id && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busyId !== null}
                      onClick={() => void toggle(u)}
                    >
                      {busyId === u.id ? 'Saving…' : u.is_active ? 'Suspend' : 'Reactivate'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pager offset={offset} limit={data.limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </section>
  );
}
