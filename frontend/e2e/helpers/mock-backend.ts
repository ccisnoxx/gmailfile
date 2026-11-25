import type { Page, Route } from '@playwright/test';

export type MockAccount = {
  id: string;
  account_no: string;
  gmail_email: string;
  password: string;
  registered_at: string;
  recovery_account_id: string | null;
  recovery_email_external: string | null;
  recovery_email: string;
  status:
    | 'normal'
    | 'pending_verification'
    | 'restricted'
    | 'login_failed'
    | 'disabled'
    | 'archived';
  two_factor_status: 'unknown' | 'disabled' | 'enabled';
  purpose: string | null;
  tags: { id: string; name: string; created_at: string }[];
  last_login_at: string | null;
  last_verified_at: string | null;
  password_changed_at: string | null;
  archived_at: string | null;
  deleted_at: string | null;
  row_version: number;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CsvReceiptState = {
  id: string;
  content: string;
  strategy: 'skip' | 'update' | 'error';
  consumed: boolean;
  snapshot: string;
  rows: { row: number; action: 'create' | 'update' | 'skip' | 'error' }[];
};

export type MockBackendOptions = {
  initialState?: 'anonymous' | 'mfa_pending' | 'authenticated';
  adminPassword?: string;
  totpEnabled?: boolean;
  validTotpCode?: string;
  stepUpTotpRequired?: boolean;
  accounts?: Partial<MockAccount>[];
  tags?: { id: string; name: string; created_at: string }[];
  commitDelayMs?: number;
};

function normalizeEmail(raw: string): string {
  const [localRaw, domainRaw = ''] = raw.trim().toLowerCase().split('@');
  if (domainRaw === 'gmail.com' || domainRaw === 'googlemail.com') {
    const clean = localRaw.split('+')[0].replaceAll('.', '');
    return `${clean}@gmail.com`;
  }
  return `${localRaw}@${domainRaw}`;
}

function errorPayload(
  code: string,
  message: string,
  details: Record<string, string> = {},
) {
  return {
    error: { code, message, details },
    request_id: crypto.randomUUID(),
  };
}

export function createMockAccount(
  overrides: Partial<MockAccount> = {},
  seq = 1,
): MockAccount {
  const now = new Date().toISOString();
  const recoveryExternal =
    overrides.recovery_account_id !== undefined &&
    overrides.recovery_account_id !== null
      ? null
      : (overrides.recovery_email_external ?? 'recovery@example.test');
  return {
    id: overrides.id ?? crypto.randomUUID(),
    account_no: overrides.account_no ?? `GM-${String(seq).padStart(6, '0')}`,
    gmail_email: overrides.gmail_email ?? `account${seq}@gmail.com`,
    password: overrides.password ?? `SyntheticAccountPass#${seq}!`,
    registered_at: overrides.registered_at ?? now,
    recovery_account_id: overrides.recovery_account_id ?? null,
    recovery_email_external: recoveryExternal,
    recovery_email:
      overrides.recovery_email ?? recoveryExternal ?? 'linked-target@gmail.com',
    status: overrides.status ?? 'normal',
    two_factor_status: overrides.two_factor_status ?? 'enabled',
    purpose: overrides.purpose ?? '合成测试用途',
    tags: overrides.tags ?? [],
    last_login_at: overrides.last_login_at ?? null,
    last_verified_at: overrides.last_verified_at ?? null,
    password_changed_at: overrides.password_changed_at ?? null,
    archived_at: overrides.archived_at ?? null,
    deleted_at: overrides.deleted_at ?? null,
    row_version: overrides.row_version ?? 1,
    phone: overrides.phone ?? '+86 138 0013 8000',
    notes: overrides.notes ?? '合成敏感备注',
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

function stripSummary(acc: MockAccount) {
  const { password: _p, phone: _ph, notes: _n, ...rest } = acc;
  return rest;
}

function stripDetail(acc: MockAccount) {
  const { password: _p, ...rest } = acc;
  return rest;
}

export async function installMockBackend(
  page: Page,
  options: MockBackendOptions = {},
) {
  let adminPassword = options.adminPassword ?? 'AdminStrongPassphrase#2026';
  let totpEnabled =
    options.totpEnabled ?? options.initialState === 'authenticated';
  let validTotpCode = options.validTotpCode ?? '246810';
  let nextTotpCode = '135791';
  const usedTotpCodes = new Set<string>();
  let recoveryCodes = Array.from(
    { length: 10 },
    (_, i) => `rec-code-${String(i + 1).padStart(2, '0')}-abcdef0123456789`,
  );
  let pendingSecret: string | null = null;
  let state: 'anonymous' | 'mfa_pending' | 'authenticated' =
    options.initialState ?? 'anonymous';
  let csrfToken = `csrf-${crypto.randomUUID()}`;
  let reauthenticatedUntil: string | null = null;
  let mfaReauthenticatedUntil: string | null = null;
  const stepUpTotpRequired = options.stepUpTotpRequired ?? false;
  let idleMinutes = 15;
  let nextAccountSeq = (options.accounts?.length ?? 0) + 1;

  const accounts: MockAccount[] = (options.accounts ?? []).map((item, idx) =>
    createMockAccount(item, idx + 1),
  );
  const tags = [...(options.tags ?? [])];
  const receipts = new Map<string, CsvReceiptState>();
  const sessions = [
    {
      id: 'sess-current-1',
      current: true,
      state: 'valid' as const,
      auth_level: 'authenticated' as const,
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
      last_seen_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 43_200_000).toISOString(),
      idle_expires_at: new Date(Date.now() + 900_000).toISOString(),
      revoked_at: null as string | null,
      ip_address: '192.0.2.10',
    },
    {
      id: 'sess-other-2',
      current: false,
      state: 'valid' as const,
      auth_level: 'authenticated' as const,
      created_at: new Date(Date.now() - 7_200_000).toISOString(),
      last_seen_at: new Date(Date.now() - 300_000).toISOString(),
      expires_at: new Date(Date.now() + 36_000_000).toISOString(),
      idle_expires_at: new Date(Date.now() + 600_000).toISOString(),
      revoked_at: null as string | null,
      ip_address: '192.0.2.25',
    },
  ];
  const audits: {
    id: string;
    seq: number;
    event_hash: string;
    event_type: string;
    account_id: string | null;
    session_id: string | null;
    ip_address: string | null;
    operation: string | null;
    created_at: string;
  }[] = [];

  const stats = {
    commitCalls: 0,
    previewCalls: 0,
    batchCalls: 0,
    patchCalls: 0,
    reverifyCalls: 0,
    passwordChangeCalls: 0,
    csrfRejected: 0,
    totpReplayRejected: 0,
  };

  const hooks: {
    forceNextCsrfInvalid: boolean;
    forceNextPreviewFail: boolean;
    forceNextCommitConflict: boolean;
    forceNextCommitAbort: boolean;
    commitDelayMs: number;
  } = {
    forceNextCsrfInvalid: false,
    forceNextPreviewFail: false,
    forceNextCommitConflict: false,
    forceNextCommitAbort: false,
    commitDelayMs: options.commitDelayMs ?? 0,
  };

  function addAudit(
    eventType: string,
    accountId: string | null = null,
    operation: string | null = null,
  ) {
    audits.unshift({
      id: crypto.randomUUID(),
      seq: audits.length + 1,
      event_hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, 'a'),
      event_type: eventType,
      account_id: accountId,
      session_id: sessions[0]?.id ?? null,
      ip_address: '192.0.2.10',
      operation,
      created_at: new Date().toISOString(),
    });
  }

  function rotateCsrf() {
    csrfToken = `csrf-${crypto.randomUUID()}`;
  }

  function sessionResponse() {
    const now = Date.now();
    return {
      state,
      idle_timeout_seconds: idleMinutes * 60,
      server_time: new Date(now).toISOString(),
      csrf_token: csrfToken,
      expires_at: new Date(now + 43_200_000).toISOString(),
      idle_expires_at: new Date(now + idleMinutes * 60_000).toISOString(),
      reauthenticated_until: reauthenticatedUntil,
      mfa_reauthenticated_until: mfaReauthenticatedUntil,
      step_up_totp_required: stepUpTotpRequired && totpEnabled,
    };
  }

  function verifyCsrf(route: Route, allowForcedInvalid = true): boolean {
    if (allowForcedInvalid && hooks.forceNextCsrfInvalid) {
      hooks.forceNextCsrfInvalid = false;
      stats.csrfRejected++;
      return false;
    }
    const sent = route.request().headers()['x-csrf-token'];
    if (!sent || sent !== csrfToken) {
      stats.csrfRejected++;
      return false;
    }
    return true;
  }

  function isReverified(): boolean {
    return Boolean(
      reauthenticatedUntil && Date.parse(reauthenticatedUntil) > Date.now(),
    );
  }

  function buildSnapshot(): string {
    return JSON.stringify(
      accounts.map((a) => [a.id, a.gmail_email, a.row_version, a.deleted_at]),
    );
  }

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify(body),
      });

    // GET /auth/session rotates CSRF token (real backend behavior)
    if (path === '/auth/session' && method === 'GET') {
      rotateCsrf();
      return json(sessionResponse());
    }

    if (path === '/auth/activity' && method === 'POST') {
      if (state === 'anonymous') {
        return json(
          errorPayload('AUTH_REQUIRED', '会话已失效，请重新登录'),
          401,
        );
      }
      if (!verifyCsrf(route, false)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      return json(sessionResponse());
    }

    if (path === '/auth/login' && method === 'POST') {
      if (!verifyCsrf(route)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      const body = req.postDataJSON() as {
        password?: string;
        totp_code?: string;
        recovery_code?: string;
      };
      if (body.password !== adminPassword) {
        return json(
          errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
          401,
        );
      }
      if (totpEnabled) {
        const hasTotp = Boolean(body.totp_code);
        const hasRecovery = Boolean(body.recovery_code);
        if (hasTotp === hasRecovery) {
          return json(
            errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
            401,
          );
        }
        if (hasRecovery) {
          const idx = recoveryCodes.indexOf(body.recovery_code ?? '');
          if (idx === -1) {
            return json(
              errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
              401,
            );
          }
          recoveryCodes.splice(idx, 1);
          sessions.forEach((s) => {
            if (!s.current) s.revoked_at = new Date().toISOString();
          });
          state = 'mfa_pending';
          reauthenticatedUntil = null;
          mfaReauthenticatedUntil = null;
          rotateCsrf();
          addAudit('recovery_code_used');
          return json(sessionResponse());
        }
        if (
          body.totp_code !== validTotpCode ||
          usedTotpCodes.has(body.totp_code)
        ) {
          if (body.totp_code && usedTotpCodes.has(body.totp_code)) {
            stats.totpReplayRejected++;
          }
          return json(
            errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
            401,
          );
        }
        usedTotpCodes.add(body.totp_code);
        state = 'authenticated';
      } else {
        state = 'mfa_pending';
      }
      reauthenticatedUntil = null;
      mfaReauthenticatedUntil = null;
      rotateCsrf();
      addAudit(
        state === 'authenticated' ? 'login_success' : 'password_verified',
      );
      return json(sessionResponse());
    }

    if (path === '/auth/logout' && method === 'POST') {
      if (state === 'anonymous') {
        return json(errorPayload('AUTH_REQUIRED', '会话已失效'), 401);
      }
      if (!verifyCsrf(route)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      state = 'anonymous';
      reauthenticatedUntil = null;
      mfaReauthenticatedUntil = null;
      pendingSecret = null;
      addAudit('logout');
      return json({ status: 'ok' });
    }

    if (path === '/auth/totp/setup' && method === 'POST') {
      if (state === 'anonymous') {
        return json(errorPayload('AUTH_REQUIRED', '会话已失效'), 401);
      }
      if (!verifyCsrf(route)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      pendingSecret = 'JBSWY3DPEHPK3PXP';
      addAudit('totp_setup_started');
      const svg =
        'data:image/svg+xml;base64,' +
        btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#111"/></svg>',
        );
      return json({
        session: sessionResponse(),
        secret: pendingSecret,
        qr_data_url: svg,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
    }

    if (path === '/auth/totp/confirm' && method === 'POST') {
      if (state === 'anonymous') {
        return json(errorPayload('AUTH_REQUIRED', '会话已失效'), 401);
      }
      if (!verifyCsrf(route)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      if (!pendingSecret) {
        return json(errorPayload('SETUP_REQUIRED', '请先开始绑定'), 403);
      }
      const body = req.postDataJSON() as { code?: string };
      if (body.code !== nextTotpCode && body.code !== validTotpCode) {
        return json(
          errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
          401,
        );
      }
      totpEnabled = true;
      validTotpCode = body.code === nextTotpCode ? '987654' : '135791';
      usedTotpCodes.add(body.code!);
      pendingSecret = null;
      state = 'authenticated';
      rotateCsrf();
      recoveryCodes = Array.from(
        { length: 10 },
        (_, i) =>
          `new-rec-${String(i + 1).padStart(2, '0')}-${crypto.randomUUID().slice(0, 8)}`,
      );
      addAudit('totp_bound');
      return json({
        session: sessionResponse(),
        recovery_codes: [...recoveryCodes],
      });
    }

    if (path === '/auth/reverify' && method === 'POST') {
      stats.reverifyCalls++;
      if (state !== 'authenticated') {
        return json(errorPayload('AUTH_REQUIRED', '会话已失效'), 401);
      }
      if (!verifyCsrf(route)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      const body = req.postDataJSON() as {
        password?: string;
        totp_code?: string;
      };
      if (body.password !== adminPassword) {
        return json(
          errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
          401,
        );
      }
      const needMfa =
        Boolean(body.totp_code) || (stepUpTotpRequired && totpEnabled);
      if (needMfa) {
        if (
          !body.totp_code ||
          body.totp_code !== validTotpCode ||
          usedTotpCodes.has(body.totp_code)
        ) {
          if (body.totp_code && usedTotpCodes.has(body.totp_code)) {
            stats.totpReplayRejected++;
          }
          return json(
            errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
            401,
          );
        }
        usedTotpCodes.add(body.totp_code);
        mfaReauthenticatedUntil = new Date(Date.now() + 300_000).toISOString();
      }
      reauthenticatedUntil = new Date(Date.now() + 300_000).toISOString();
      // 真实后端在 reverify 成功时必定轮换 CSRF token！
      rotateCsrf();
      addAudit('password_reverified', null, 'reverify');
      return json(sessionResponse());
    }

    if (path === '/auth/totp/regenerate-recovery-codes' && method === 'POST') {
      if (state !== 'authenticated') {
        return json(errorPayload('AUTH_REQUIRED', '会话已失效'), 401);
      }
      if (!verifyCsrf(route)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      if (!isReverified()) {
        return json(
          errorPayload('REAUTH_REQUIRED', '请先重新验证管理员密码'),
          403,
        );
      }
      const body = req.postDataJSON() as {
        password?: string;
        totp_code?: string;
      };
      if (
        body.password !== adminPassword ||
        !body.totp_code ||
        body.totp_code !== validTotpCode ||
        usedTotpCodes.has(body.totp_code)
      ) {
        if (body.totp_code && usedTotpCodes.has(body.totp_code)) {
          stats.totpReplayRejected++;
        }
        return json(
          errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
          401,
        );
      }
      usedTotpCodes.add(body.totp_code);
      rotateCsrf();
      recoveryCodes = Array.from(
        { length: 10 },
        (_, i) =>
          `regen-${String(i + 1).padStart(2, '0')}-${crypto.randomUUID().slice(0, 8)}`,
      );
      addAudit('recovery_codes_regenerated');
      return json({
        session: sessionResponse(),
        recovery_codes: [...recoveryCodes],
      });
    }

    if (path === '/auth/password' && method === 'POST') {
      stats.passwordChangeCalls++;
      if (state !== 'authenticated') {
        return json(errorPayload('AUTH_REQUIRED', '会话已失效'), 401);
      }
      if (!verifyCsrf(route)) {
        return json(errorPayload('CSRF_INVALID', '请求校验失败'), 403);
      }
      if (!isReverified()) {
        return json(
          errorPayload('REAUTH_REQUIRED', '请先重新验证管理员密码'),
          403,
        );
      }
      const body = req.postDataJSON() as {
        password?: string;
        new_password?: string;
      };
      if (body.password !== adminPassword) {
        return json(
          errorPayload('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
          401,
        );
      }
      if (!body.new_password || body.new_password.length < 16) {
        return json(errorPayload('WEAK_PASSWORD', '密码长度至少 16 位'), 422);
      }
      adminPassword = body.new_password;
      state = 'anonymous';
      reauthenticatedUntil = null;
      mfaReauthenticatedUntil = null;
      sessions.forEach((s) => {
        s.revoked_at = new Date().toISOString();
      });
      addAudit('admin_password_changed', null, 'password_change');
      return json({ status: 'ok' });
    }

    // All remaining routes require full authentication
    if (state === 'anonymous') {
      return json(errorPayload('AUTH_REQUIRED', '会话已失效，请重新登录'), 401);
    }
    if (state !== 'authenticated') {
      return json(errorPayload('MFA_REQUIRED', '请先完成二步验证绑定'), 403);
    }
    if (method !== 'GET' && !verifyCsrf(route)) {
      return json(
        errorPayload('CSRF_INVALID', '请求校验失败，请刷新页面后重试'),
        403,
      );
    }

    // Dashboard summary
    if (path === '/dashboard/summary' && method === 'GET') {
      const active = accounts.filter((a) => !a.deleted_at);
      return json({
        total: active.length,
        normal: active.filter((a) => a.status === 'normal').length,
        pending_verification: active.filter(
          (a) => a.status === 'pending_verification',
        ).length,
        abnormal: active.filter((a) =>
          ['restricted', 'login_failed', 'disabled'].includes(a.status),
        ).length,
        added_this_month: active.length,
        unverified_over_30_days: 0,
        timezone: url.searchParams.get('timezone') || 'UTC',
        month_from: new Date().toISOString(),
        month_to: new Date().toISOString(),
      });
    }

    // Tags
    if (path === '/tags' && method === 'GET') {
      return json(tags);
    }
    if (path === '/tags' && method === 'POST') {
      const body = req.postDataJSON() as { name: string };
      const tag = {
        id: crypto.randomUUID(),
        name: body.name.trim(),
        created_at: new Date().toISOString(),
      };
      tags.push(tag);
      return json(tag, 201);
    }

    // Accounts list & create
    if (path === '/accounts' && method === 'GET') {
      const deleted = url.searchParams.get('deleted') === 'true';
      const archivedParam = url.searchParams.get('archived');
      const statusParam = url.searchParams.get('status');
      const searchParam = (url.searchParams.get('search') || '').toLowerCase();
      const pageNum = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('page_size') || 30);

      let filtered = accounts.filter((a) =>
        deleted ? Boolean(a.deleted_at) : !a.deleted_at,
      );
      if (archivedParam === 'true') {
        filtered = filtered.filter((a) => a.status === 'archived');
      } else if (archivedParam === 'false') {
        filtered = filtered.filter((a) => a.status !== 'archived');
      }
      if (statusParam) {
        filtered = filtered.filter((a) => a.status === statusParam);
      }
      if (searchParam) {
        filtered = filtered.filter(
          (a) =>
            a.gmail_email.toLowerCase().includes(searchParam) ||
            a.recovery_email.toLowerCase().includes(searchParam) ||
            a.account_no.toLowerCase().includes(searchParam),
        );
      }
      const start = (pageNum - 1) * pageSize;
      return json({
        items: filtered.slice(start, start + pageSize).map(stripSummary),
        total: filtered.length,
        page: pageNum,
        page_size: pageSize,
        max_page_size: 100,
      });
    }

    if (path === '/accounts/options' && method === 'GET') {
      const active = accounts.filter((a) => !a.deleted_at);
      return json({
        items: active.map((a) => ({
          id: a.id,
          account_no: a.account_no,
          gmail_email: a.gmail_email,
        })),
        total: active.length,
        page: 1,
        page_size: 30,
      });
    }

    if (path === '/accounts' && method === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      const hasLinked = Boolean(body.recovery_account_id);
      const hasExternal = Boolean(body.recovery_email_external);
      if (hasLinked === hasExternal) {
        return json(
          errorPayload('RECOVERY_INVALID', '辅助邮箱必须且只能填写一种'),
          422,
        );
      }
      const norm = normalizeEmail(String(body.gmail_email ?? ''));
      if (accounts.some((a) => normalizeEmail(a.gmail_email) === norm)) {
        return json(
          errorPayload('ACCOUNT_EMAIL_DUPLICATE', '该邮箱已存在'),
          409,
        );
      }
      const linkedTarget = hasLinked
        ? accounts.find((a) => a.id === body.recovery_account_id)
        : null;
      const created = createMockAccount(
        {
          gmail_email: String(body.gmail_email),
          password: String(body.password),
          registered_at: String(body.registered_at ?? new Date().toISOString()),
          recovery_account_id: hasLinked
            ? String(body.recovery_account_id)
            : null,
          recovery_email_external: hasExternal
            ? String(body.recovery_email_external)
            : null,
          recovery_email: hasLinked
            ? (linkedTarget?.gmail_email ?? 'linked@gmail.com')
            : String(body.recovery_email_external),
          phone: (body.phone as string | null) ?? null,
          notes: (body.notes as string | null) ?? null,
          purpose: (body.purpose as string | null) ?? null,
          status:
            (body.status as MockAccount['status']) ?? 'pending_verification',
          two_factor_status:
            (body.two_factor_status as MockAccount['two_factor_status']) ??
            'unknown',
        },
        nextAccountSeq++,
      );
      accounts.unshift(created);
      addAudit('account_created', created.id);
      return json(stripDetail(created), 201);
    }

    // Batch status & batch tags (atomic rollback!)
    if (path === '/accounts/batch-status' && method === 'POST') {
      stats.batchCalls++;
      const body = req.postDataJSON() as {
        accounts: { id: string; row_version: number }[];
        status: MockAccount['status'];
      };
      for (const item of body.accounts) {
        const target = accounts.find((a) => a.id === item.id);
        if (!target) {
          return json(
            errorPayload('ACCOUNT_NOT_FOUND', '账号不存在', {
              account_id: item.id,
            }),
            404,
          );
        }
        if (target.deleted_at) {
          return json(
            errorPayload('ACCOUNT_DELETED', '请先恢复账号再操作', {
              account_id: item.id,
            }),
            409,
          );
        }
        if (target.row_version !== item.row_version) {
          return json(
            errorPayload(
              'ROW_VERSION_CONFLICT',
              '账号已在其他页面修改，请重新加载后再操作',
              { account_id: item.id },
            ),
            409,
          );
        }
      }
      const now = new Date().toISOString();
      for (const item of body.accounts) {
        const target = accounts.find((a) => a.id === item.id)!;
        target.status = body.status;
        target.archived_at =
          body.status === 'archived' ? (target.archived_at ?? now) : null;
        target.row_version += 1;
        target.updated_at = now;
        addAudit('account_updated', target.id, 'batch-status');
      }
      return json({ updated_ids: body.accounts.map((i) => i.id) });
    }

    if (path === '/accounts/batch-tags' && method === 'POST') {
      stats.batchCalls++;
      const body = req.postDataJSON() as {
        accounts: { id: string; row_version: number }[];
        tag_ids: string[];
      };
      for (const item of body.accounts) {
        const target = accounts.find((a) => a.id === item.id);
        if (!target || target.row_version !== item.row_version) {
          return json(
            errorPayload(
              'ROW_VERSION_CONFLICT',
              '账号已在其他页面修改，请重新加载后再操作',
              { account_id: item.id },
            ),
            409,
          );
        }
      }
      const matchedTags = tags.filter((t) => body.tag_ids.includes(t.id));
      const now = new Date().toISOString();
      for (const item of body.accounts) {
        const target = accounts.find((a) => a.id === item.id)!;
        const existingIds = new Set(target.tags.map((t) => t.id));
        for (const tag of matchedTags) {
          if (!existingIds.has(tag.id)) target.tags.push(tag);
        }
        target.row_version += 1;
        target.updated_at = now;
        addAudit('account_updated', target.id, 'batch-tags');
      }
      return json({ updated_ids: body.accounts.map((i) => i.id) });
    }

    // Account detail / patch / delete / actions
    const accountMatch = /^\/accounts\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (accountMatch) {
      const [, accountId, subAction] = accountMatch;
      const target = accounts.find((a) => a.id === accountId);
      if (!target) {
        return json(errorPayload('ACCOUNT_NOT_FOUND', '账号不存在'), 404);
      }

      if (!subAction && method === 'GET') {
        return json(stripDetail(target));
      }

      if (!subAction && method === 'PATCH') {
        stats.patchCalls++;
        if (target.deleted_at) {
          return json(
            errorPayload('ACCOUNT_DELETED', '请先恢复账号再编辑'),
            409,
          );
        }
        const body = req.postDataJSON() as Record<string, unknown>;
        const nextLinked =
          'recovery_account_id' in body
            ? body.recovery_account_id
            : target.recovery_account_id;
        const nextExternal =
          'recovery_email_external' in body
            ? body.recovery_email_external
            : target.recovery_email_external;
        if (Boolean(nextLinked) === Boolean(nextExternal)) {
          return json(
            errorPayload('RECOVERY_INVALID', '辅助邮箱必须且只能填写一种'),
            422,
          );
        }
        if (body.row_version !== target.row_version) {
          return json(
            errorPayload(
              'ROW_VERSION_CONFLICT',
              '账号已在其他页面修改，请重新加载后再操作',
            ),
            409,
          );
        }
        if (typeof body.gmail_email === 'string') {
          target.gmail_email = body.gmail_email;
        }
        if (typeof body.password === 'string' && body.password) {
          target.password = body.password;
        }
        if ('phone' in body)
          target.phone = (body.phone as string | null) ?? null;
        if ('notes' in body)
          target.notes = (body.notes as string | null) ?? null;
        if ('purpose' in body) {
          target.purpose = (body.purpose as string | null) ?? null;
        }
        if ('status' in body && typeof body.status === 'string') {
          target.status = body.status as MockAccount['status'];
          target.archived_at =
            target.status === 'archived'
              ? (target.archived_at ?? new Date().toISOString())
              : null;
        }
        if (
          'two_factor_status' in body &&
          typeof body.two_factor_status === 'string'
        ) {
          target.two_factor_status =
            body.two_factor_status as MockAccount['two_factor_status'];
        }
        target.recovery_account_id = (nextLinked as string | null) ?? null;
        target.recovery_email_external =
          (nextExternal as string | null) ?? null;
        if (nextExternal) {
          target.recovery_email = String(nextExternal);
        }
        target.row_version += 1;
        target.updated_at = new Date().toISOString();
        addAudit('account_updated', target.id);
        return json(stripDetail(target));
      }

      if (!subAction && method === 'DELETE') {
        const body = req.postDataJSON() as { row_version: number };
        if (body.row_version !== target.row_version) {
          return json(errorPayload('ROW_VERSION_CONFLICT', '版本冲突'), 409);
        }
        target.deleted_at = new Date().toISOString();
        target.row_version += 1;
        addAudit('account_deleted', target.id, 'delete');
        return json(stripDetail(target));
      }

      if (subAction === 'archive' && method === 'POST') {
        const body = req.postDataJSON() as { row_version: number };
        if (body.row_version !== target.row_version) {
          return json(errorPayload('ROW_VERSION_CONFLICT', '版本冲突'), 409);
        }
        target.status = 'archived';
        target.archived_at = new Date().toISOString();
        target.row_version += 1;
        addAudit('account_archived', target.id, 'archive');
        return json(stripDetail(target));
      }

      if (subAction === 'restore' && method === 'POST') {
        const body = req.postDataJSON() as { row_version: number };
        if (!target.deleted_at) {
          return json(
            errorPayload('ACCOUNT_NOT_DELETED', '该账号未被删除'),
            409,
          );
        }
        if (body.row_version !== target.row_version) {
          return json(errorPayload('ROW_VERSION_CONFLICT', '版本冲突'), 409);
        }
        target.deleted_at = null;
        target.row_version += 1;
        addAudit('account_restored', target.id, 'restore');
        return json(stripDetail(target));
      }

      if (subAction === 'mark-verified' && method === 'POST') {
        const body = req.postDataJSON() as { row_version: number };
        if (body.row_version !== target.row_version) {
          return json(errorPayload('ROW_VERSION_CONFLICT', '版本冲突'), 409);
        }
        target.last_verified_at = new Date().toISOString();
        target.row_version += 1;
        addAudit('account_updated', target.id, 'mark-verified');
        return json(stripDetail(target));
      }

      if (subAction === 'mark-logged-in' && method === 'POST') {
        const body = req.postDataJSON() as { row_version: number };
        if (body.row_version !== target.row_version) {
          return json(errorPayload('ROW_VERSION_CONFLICT', '版本冲突'), 409);
        }
        target.last_login_at = new Date().toISOString();
        target.row_version += 1;
        addAudit('account_updated', target.id, 'mark-logged-in');
        return json(stripDetail(target));
      }

      if (subAction === 'reveal-password' && method === 'POST') {
        if (!isReverified()) {
          return json(
            errorPayload('REAUTH_REQUIRED', '请先重新验证管理员密码'),
            403,
          );
        }
        addAudit('password_revealed', target.id);
        return json({ password: target.password });
      }

      if (subAction === 'copy-password-event' && method === 'POST') {
        if (!isReverified()) {
          return json(
            errorPayload('REAUTH_REQUIRED', '请先重新验证管理员密码'),
            403,
          );
        }
        addAudit('password_copied', target.id);
        return json({ status: 'ok' });
      }
    }

    // CSV preview & commit
    if (path === '/imports/csv/preview' && method === 'POST') {
      stats.previewCalls++;
      if (hooks.forceNextPreviewFail) {
        hooks.forceNextPreviewFail = false;
        return json(errorPayload('CSV_INVALID', 'CSV 服务端校验未通过'), 422);
      }
      const rawText = req.postData() ?? '';
      const rawOpts = url.searchParams.get('options');
      const parsedOpts = rawOpts
        ? (JSON.parse(rawOpts) as {
            strategy?: 'skip' | 'update' | 'error';
            mapping?: Record<string, number>;
          })
        : {};
      const strategy = parsedOpts.strategy ?? 'skip';
      const lines = rawText
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const headers = (lines[0] ?? '').split(',').map((h) => h.trim());
      const defaultMapping: Record<string, number> = {};
      headers.forEach((h, idx) => {
        if (h === 'gmail' || h === 'gmail_email')
          defaultMapping.gmail_email = idx;
        else if (h === 'password') defaultMapping.password = idx;
        else if (h === 'recovery_email') defaultMapping.recovery_email = idx;
        else if (h === 'phone') defaultMapping.phone = idx;
        else if (h === 'status') defaultMapping.status = idx;
        else if (h === 'two_factor_status' || h === 'totp_enabled') {
          defaultMapping.two_factor_status = idx;
        } else if (h === 'purpose') defaultMapping.purpose = idx;
      });
      const mapping = parsedOpts.mapping ?? defaultMapping;
      const rows: {
        row: number;
        action: 'create' | 'update' | 'skip' | 'error';
      }[] = [];
      const errors: { row: number; field: string; reason: string }[] = [];
      const seen = new Set<string>();
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',');
        const email = (cells[mapping.gmail_email] ?? '').trim();
        const norm = normalizeEmail(email);
        const existing = accounts.find(
          (a) => normalizeEmail(a.gmail_email) === norm,
        );
        if (!email.includes('@')) {
          rows.push({ row: i + 1, action: 'error' });
          errors.push({
            row: i + 1,
            field: 'gmail_email',
            reason: '邮箱格式不正确',
          });
        } else if (seen.has(norm)) {
          if (strategy === 'error') {
            rows.push({ row: i + 1, action: 'error' });
            errors.push({
              row: i + 1,
              field: 'gmail_email',
              reason: '文件内地址重复',
            });
          } else {
            rows.push({ row: i + 1, action: 'skip' });
          }
        } else {
          seen.add(norm);
          if (existing) {
            if (strategy === 'error') {
              rows.push({ row: i + 1, action: 'error' });
              errors.push({
                row: i + 1,
                field: 'gmail_email',
                reason: '数据库中已有该地址',
              });
            } else if (strategy === 'skip') {
              rows.push({ row: i + 1, action: 'skip' });
            } else {
              rows.push({ row: i + 1, action: 'update' });
            }
          } else {
            rows.push({ row: i + 1, action: 'create' });
          }
        }
      }
      const receiptId = errors.length === 0 ? crypto.randomUUID() : null;
      if (receiptId) {
        receipts.set(receiptId, {
          id: receiptId,
          content: rawText,
          strategy,
          consumed: false,
          snapshot: buildSnapshot(),
          rows,
        });
      }
      return json({
        receipt_id: receiptId,
        expires_at: receiptId
          ? new Date(Date.now() + 600_000).toISOString()
          : null,
        mapping,
        strategy,
        columns: headers.map((_h, index) => ({
          index,
          suggested_field:
            Object.entries(defaultMapping).find(
              ([, col]) => col === index,
            )?.[0] ?? null,
        })),
        rows,
        errors,
      });
    }

    if (path === '/imports/csv/commit' && method === 'POST') {
      stats.commitCalls++;
      if (hooks.commitDelayMs > 0) {
        await new Promise((r) => setTimeout(r, hooks.commitDelayMs));
      }
      if (hooks.forceNextCommitAbort) {
        hooks.forceNextCommitAbort = false;
        return route.abort('failed');
      }
      const receiptId = url.searchParams.get('receipt_id') ?? '';
      const receipt = receipts.get(receiptId);
      const rawText = req.postData() ?? '';
      if (
        hooks.forceNextCommitConflict ||
        !receipt ||
        receipt.consumed ||
        receipt.content !== rawText ||
        receipt.snapshot !== buildSnapshot()
      ) {
        hooks.forceNextCommitConflict = false;
        return json(
          {
            status: 'rejected',
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [
              {
                row: 2,
                field: 'row_version',
                reason: '预览后记录已变化或凭据已被并发提交消费，请重新预览',
              },
            ],
          },
          409,
        );
      }
      receipt.consumed = true;
      const createdCount = receipt.rows.filter(
        (r) => r.action === 'create',
      ).length;
      const updatedCount = receipt.rows.filter(
        (r) => r.action === 'update',
      ).length;
      const skippedCount = receipt.rows.filter(
        (r) => r.action === 'skip',
      ).length;
      addAudit('csv_imported', null, 'csv');
      return json({
        status: 'committed',
        created: createdCount,
        updated: updatedCount,
        skipped: skippedCount,
        errors: [],
      });
    }

    // Sessions / audits / settings / system
    if (path === '/auth/sessions' && method === 'GET') {
      return json({
        items: sessions.map((s) => ({
          ...s,
          state: s.revoked_at ? 'revoked' : s.state,
        })),
        total: sessions.length,
        page: 1,
        page_size: 20,
      });
    }

    if (path === '/auth/sessions/others' && method === 'DELETE') {
      if (!isReverified()) {
        return json(errorPayload('REAUTH_REQUIRED', '请先重新验证'), 403);
      }
      sessions.forEach((s) => {
        if (!s.current) s.revoked_at = new Date().toISOString();
      });
      return json({ status: 'ok' });
    }

    if (path.startsWith('/auth/sessions/') && method === 'DELETE') {
      if (!isReverified()) {
        return json(errorPayload('REAUTH_REQUIRED', '请先重新验证'), 403);
      }
      const id = path.split('/').pop();
      const target = sessions.find((s) => s.id === id);
      if (target) target.revoked_at = new Date().toISOString();
      if (target?.current) state = 'anonymous';
      return json({ status: 'ok' });
    }

    if (path === '/audit-events' && method === 'GET') {
      return json({
        items: audits,
        total: audits.length,
        page: 1,
        page_size: 30,
        event_types: ['account_created', 'account_updated', 'csv_imported'],
      });
    }

    if (path === '/audit-events/integrity' && method === 'GET') {
      return json({
        valid: true,
        total_events: audits.length,
        latest_seq: audits[0]?.seq ?? null,
        latest_hash: audits[0]?.event_hash ?? null,
        retention_days: 365,
      });
    }

    if (path === '/settings' && method === 'GET') {
      return json({ idle_minutes: idleMinutes, max_idle_minutes: 720 });
    }

    if (path === '/settings/idle' && method === 'PATCH') {
      if (!isReverified()) {
        return json(errorPayload('REAUTH_REQUIRED', '请先重新验证'), 403);
      }
      const body = req.postDataJSON() as { idle_minutes: number };
      idleMinutes = body.idle_minutes;
      return json({ idle_minutes: idleMinutes, max_idle_minutes: 720 });
    }

    if (path === '/system/version' && method === 'GET') {
      return json({ version: '1.2.0', schema_version: '0004' });
    }

    if (path === '/system/backup-status' && method === 'GET') {
      return json({
        state: 'success',
        offsite: 'success',
        last_success_at: new Date().toISOString(),
      });
    }

    return json(
      errorPayload('NOT_FOUND', `Unhandled mock route: ${method} ${path}`),
      404,
    );
  });

  return {
    accounts,
    tags,
    sessions,
    audits,
    stats,
    hooks,
    getAdminPassword: () => adminPassword,
    getValidTotpCode: () => validTotpCode,
    getNextTotpCode: () => nextTotpCode,
    getRecoveryCodes: () => [...recoveryCodes],
    getState: () => state,
    bumpVersion(accountId: string) {
      const target = accounts.find((a) => a.id === accountId);
      if (target) target.row_version += 1;
    },
  };
}
