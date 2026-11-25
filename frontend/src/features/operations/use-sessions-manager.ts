import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  sessionsList,
  sessionsRevoke,
  sessionsRevokeOthers,
} from '@/api/generated';
import type { SessionResponse } from '@/api/generated';
import { failureText } from './shared';

export const sessionLabels = {
  valid: '有效',
  idle_expired: '闲置过期',
  absolute_expired: '绝对过期',
  revoked: '已撤销',
} as const;

export function useSessionsManager({
  session,
  onFailure,
  onSignedOut,
}: {
  session: SessionResponse;
  onFailure: (error: unknown) => void;
  onSignedOut: (revocation: Promise<unknown>) => void;
}) {
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const query = useQuery({
    queryKey: ['sessions', page],
    queryFn: async ({ signal }) =>
      (
        await sessionsList({
          query: { page, page_size: 10 },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  useEffect(() => {
    if (query.error) onFailure(query.error);
  }, [query.error, onFailure]);

  const confirmRevoke = useCallback(async () => {
    if (!target || busy) return;
    const selected = target;
    setBusy(true);
    setMessage('');
    try {
      const options = {
        headers: { 'X-CSRF-Token': session.csrf_token },
        throwOnError: true as const,
      };
      if (query.data?.items.some((s) => s.id === selected && s.current)) {
        // Clear the workspace immediately, without racing a CSRF refresh against DELETE.
        onSignedOut(
          sessionsRevoke({
            ...options,
            path: { session_id: selected },
          }),
        );
        return;
      }
      if (selected === 'others') await sessionsRevokeOthers(options);
      else
        await sessionsRevoke({
          ...options,
          path: { session_id: selected },
        });
      if (!alive.current) return;
      setTarget(null);
      void query.refetch();
    } catch (error) {
      if (alive.current) {
        setTarget(null);
        setMessage(failureText(error, true));
        onFailure(error);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [busy, onFailure, onSignedOut, query, session.csrf_token, target]);

  return {
    page,
    setPage,
    target,
    setTarget,
    busy,
    message,
    query,
    confirmRevoke,
  };
}
