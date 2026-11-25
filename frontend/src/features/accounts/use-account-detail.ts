import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AccountCreateWritable,
  AccountDetail,
  AccountSummary,
  ErrorResponse,
  SessionResponse,
} from '@/api/generated';
import {
  accountsArchive,
  accountsCreate,
  accountsDelete,
  accountsDetail,
  accountsMarkLoggedIn,
  accountsMarkVerified,
  accountsPatch,
  accountsRestore,
} from '@/api/generated';
import { actionLabels, type AccountAction } from './constants';

export function useAccountDetail({
  session,
  search,
  onFailure,
  onRefresh,
}: {
  session: SessionResponse;
  search: string;
  onFailure: (error: unknown) => void;
  onRefresh: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [drawerLoaded, setDrawerLoaded] = useState(false);
  const [form, setForm] = useState<'new' | 'edit' | null>(null);
  const [formLoaded, setFormLoaded] = useState(false);
  const [confirm, setConfirm] = useState<AccountAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [secretEpoch, setSecretEpoch] = useState(0);
  const generation = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);

  const headers = { 'X-CSRF-Token': session.csrf_token };

  const captureFocus = useCallback(() => {
    if (
      document.activeElement instanceof HTMLElement &&
      !document.activeElement.closest('[role="dialog"]')
    ) {
      returnFocus.current = document.activeElement;
    }
  }, []);

  const restoreFocus = useCallback((event: Event) => {
    event.preventDefault();
    returnFocus.current?.focus();
  }, []);

  const fail = useCallback(
    (error: unknown) => {
      const code = (error as Partial<ErrorResponse>)?.error?.code;
      if (code === 'ROW_VERSION_CONFLICT') {
        setConflict(true);
        setNotice(
          '账号已被其他页面修改。当前内容未覆盖服务器，请重新加载最新版本后再编辑。',
        );
      } else {
        setNotice(
          (error as Partial<ErrorResponse>)?.error?.message ??
            '无法连接服务，请稍后手动重试。',
        );
      }
      if (
        ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code ?? '')
      )
        onFailure(error);
    },
    [onFailure],
  );

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      setNotice('');
      const ticket = generation.current;
      try {
        await action();
      } catch (error) {
        if (ticket === generation.current) fail(error);
      } finally {
        if (ticket === generation.current) setBusy(false);
      }
    },
    [busy, fail],
  );

  const close = useCallback(() => {
    generation.current++;
    setBusy(false);
    setDrawer(false);
    setForm(null);
    setDetail(null);
    setConflict(false);
    setSecretEpoch((n) => n + 1);
  }, []);

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        generation.current++;
        setDrawer(false);
        setForm(null);
        setDetail(null);
        setSecretEpoch((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  useEffect(() => {
    close();
  }, [close, search]);

  const open = useCallback(
    async (account: AccountSummary, edit = false, action?: AccountAction) => {
      captureFocus();
      const ticket = ++generation.current;
      setDetail(null);
      setForm(null);
      setConflict(false);
      setNotice('');
      if (!edit) {
        setDrawerLoaded(true);
        setDrawer(true);
      } else {
        setDrawer(false);
      }
      setBusy(true);
      try {
        const { data } = await accountsDetail({
          path: { account_id: account.id },
          throwOnError: true,
        });
        if (ticket === generation.current && !document.hidden) {
          setDetail(data);
          if (edit) {
            setFormLoaded(true);
            setForm('edit');
          }
          if (action) setConfirm(action);
        }
      } catch (error) {
        if (ticket === generation.current) fail(error);
      } finally {
        if (ticket === generation.current) setBusy(false);
      }
    },
    [captureFocus, fail],
  );

  const openNew = useCallback(() => {
    close();
    returnFocus.current = document.activeElement as HTMLElement;
    setFormLoaded(true);
    setForm('new');
  }, [close]);

  const openEditFromDrawer = useCallback(() => {
    setSecretEpoch((n) => n + 1);
    setDrawer(false);
    setFormLoaded(true);
    setForm('edit');
  }, []);

  const requestAction = useCallback((action: AccountAction) => {
    setSecretEpoch((n) => n + 1);
    setConfirm(action);
  }, []);

  const copy = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('邮箱已复制。');
    } catch {
      setNotice('浏览器不允许复制，请手动选择邮箱复制。');
    }
  }, []);

  const save = useCallback(
    async (body: AccountCreateWritable) => {
      const ticket = generation.current;
      await run(async () => {
        let data: AccountDetail;
        if (form === 'edit' && detail) {
          const patch = { ...body, row_version: detail.row_version };
          if (!body.password) Reflect.deleteProperty(patch, 'password');
          data = (
            await accountsPatch({
              path: { account_id: detail.id },
              body: patch,
              headers,
              throwOnError: true,
            })
          ).data;
        } else {
          data = (await accountsCreate({ body, headers, throwOnError: true }))
            .data;
        }
        if (ticket !== generation.current || document.hidden) {
          await onRefresh();
          return;
        }
        close();
        setNotice(`${data.account_no} 已保存。`);
        await onRefresh();
      });
    },
    [close, detail, form, headers, onRefresh, run],
  );

  const act = useCallback(
    async (action: AccountAction) => {
      if (!detail) return;
      const ticket = generation.current;
      await run(async () => {
        const fn = {
          archive: accountsArchive,
          delete: accountsDelete,
          restore: accountsRestore,
          verified: accountsMarkVerified,
          'logged-in': accountsMarkLoggedIn,
        }[action];
        const { data } = await fn({
          path: { account_id: detail.id },
          body: { row_version: detail.row_version },
          headers,
          throwOnError: true,
        });
        await onRefresh();
        if (ticket !== generation.current || document.hidden) return;
        setConfirm(null);
        setDetail(data);
        setSecretEpoch((n) => n + 1);
        setNotice(`${actionLabels[action]}成功。`);
      });
    },
    [detail, headers, onRefresh, run],
  );

  const markVerifiedQuick = useCallback(
    (account: AccountSummary) => {
      void run(async () => {
        await accountsMarkVerified({
          path: { account_id: account.id },
          body: { row_version: account.row_version },
          headers,
          throwOnError: true,
        });
        await onRefresh();
        setNotice(`${account.account_no} 今天已验证。`);
      });
    },
    [headers, onRefresh, run],
  );

  return {
    detail,
    drawer,
    drawerLoaded,
    form,
    formLoaded,
    confirm,
    setConfirm,
    busy,
    notice,
    setNotice,
    conflict,
    secretEpoch,
    headers,
    captureFocus,
    restoreFocus,
    fail,
    run,
    open,
    openNew,
    openEditFromDrawer,
    requestAction,
    close,
    copy,
    save,
    act,
    markVerifiedQuick,
  };
}
