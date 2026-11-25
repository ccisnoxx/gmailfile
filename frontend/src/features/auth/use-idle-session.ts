import { useEffect, useRef } from 'react';
import { authActivity } from '@/api/generated';
import type { SessionResponse } from '@/api/generated';

export function useIdleSession(
  session: SessionResponse | null,
  accept: (s: SessionResponse) => void,
  lock: () => void,
  failure: (e: unknown) => void,
) {
  const callbacks = useRef({ accept, lock, failure });
  callbacks.current = { accept, lock, failure };
  const lastSent = useRef(0);
  const cutoffs = useRef<{
    expires: string;
    absolute: number;
    idle: number;
  } | null>(null);
  useEffect(() => {
    if (!session || session.state === 'anonymous') {
      cutoffs.current = null;
      lastSent.current = 0;
      return;
    }
    let active = true;
    const controller = new AbortController();
    let sending = false;
    const received = Date.now();
    const offset = Date.parse(session.server_time) - received;
    const estimatedAbsolute = Date.parse(session.expires_at) - offset;
    const previous =
      cutoffs.current?.expires === session.expires_at ? cutoffs.current : null;
    const absolute = Math.min(
      estimatedAbsolute,
      previous?.absolute ?? Infinity,
    );
    let deadline = Math.min(
      Date.parse(session.idle_expires_at) - offset,
      absolute,
      previous?.idle ?? Infinity,
    );
    cutoffs.current = { expires: session.expires_at, absolute, idle: deadline };
    let timer: number;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => {
          active = false;
          controller.abort();
          callbacks.current.lock();
        },
        Math.max(0, deadline - Date.now()),
      );
    };
    schedule();
    const activity = (event: Event) => {
      if (!event.isTrusted || document.hidden || !active) return;
      const now = Date.now();
      if (now >= deadline) {
        active = false;
        callbacks.current.lock();
        return;
      }
      deadline = Math.min(now + session.idle_timeout_seconds * 1000, absolute);
      cutoffs.current!.idle = deadline;
      schedule();
      // 仅交互发送活动确认；定时器、后台查询和刷新都不能续期。
      if (
        sending ||
        now - lastSent.current <
          Math.min(60000, (session.idle_timeout_seconds * 1000) / 3)
      )
        return;
      sending = true;
      lastSent.current = now;
      void authActivity({
        headers: { 'X-CSRF-Token': session.csrf_token },
        signal: controller.signal,
        throwOnError: true,
      })
        .then(({ data }) => {
          if (active) callbacks.current.accept(data);
        })
        .catch((e) => {
          if (active) callbacks.current.failure(e);
        })
        .finally(() => {
          sending = false;
        });
    };
    const events = ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'];
    for (const name of events)
      window.addEventListener(name, activity, { passive: true });
    const visible = () => {
      if (!document.hidden && Date.now() >= deadline) {
        active = false;
        callbacks.current.lock();
      }
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, activity);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [session]);
}
