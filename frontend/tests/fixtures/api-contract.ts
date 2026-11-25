import type {
  AccountDetail,
  AccountPage,
  AccountPatchWritable,
  AccountSummary,
  ActionResponse,
  AuditIntegrityResponse,
  AuditItem,
  AuditPage,
  BackupStatus,
  CsvCommit,
  CsvPreview,
  DashboardSummary,
  ErrorResponse,
  IdleSetting,
  PasswordResponse,
  RecoveryResponse,
  SessionItem,
  SessionPage,
  SessionResponse,
  SettingsState,
  TagResponse,
  VersionState,
} from '@/api/generated';

const DEFAULT_ISO = '2026-11-20T08:00:00Z';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function buildErrorResponse(
  code: string,
  message: string,
  details: Record<string, string> = {},
): ErrorResponse {
  return {
    error: { code, message, details },
    request_id: `req-${crypto.randomUUID().slice(0, 8)}`,
  };
}

export function buildSessionResponse(
  overrides: Partial<SessionResponse> = {},
): SessionResponse {
  const now = Date.now();
  return {
    state: 'authenticated',
    idle_timeout_seconds: 900,
    server_time: new Date(now).toISOString(),
    csrf_token: 'csrf-stateful-0001',
    expires_at: new Date(now + 43_200_000).toISOString(),
    idle_expires_at: new Date(now + 900_000).toISOString(),
    reauthenticated_until: null,
    mfa_reauthenticated_until: null,
    step_up_totp_required: true,
    ...overrides,
  };
}

export function buildTag(overrides: Partial<TagResponse> = {}): TagResponse {
  return {
    id: 'tag-prod-01',
    name: '核心生产',
    created_at: DEFAULT_ISO,
    ...overrides,
  };
}

export function buildAccountDetail(
  overrides: Partial<AccountDetail> = {},
): AccountDetail {
  return {
    id: 'acc-contract-01',
    account_no: 'GM-000101',
    gmail_email: 'contract.alpha@gmail.com',
    registered_at: '2025-10-01T08:00:00Z',
    recovery_account_id: null,
    recovery_email_external: 'recovery.alpha@example.test',
    recovery_email: 'recovery.alpha@example.test',
    status: 'normal',
    two_factor_status: 'enabled',
    purpose: 'Wave 1 契约联调',
    tags: [buildTag()],
    last_login_at: '2026-11-18T12:00:00Z',
    last_verified_at: '2026-11-19T12:00:00Z',
    password_changed_at: '2026-10-15T10:00:00Z',
    archived_at: null,
    deleted_at: null,
    row_version: 1,
    created_at: '2025-10-01T08:00:00Z',
    updated_at: '2026-11-19T12:00:00Z',
    phone: '+86 13800001234',
    notes: '契约测试默认备注',
    ...overrides,
  };
}

export function toAccountSummary(detail: AccountDetail): AccountSummary {
  const { phone: _phone, notes: _notes, ...summary } = detail;
  return summary;
}

export function buildAccountPage(
  items: AccountSummary[],
  overrides: Partial<AccountPage> = {},
): AccountPage {
  return {
    max_page_size: 100,
    items,
    total: items.length,
    page: 1,
    page_size: 30,
    ...overrides,
  };
}

export function buildDashboardSummary(
  accounts: AccountDetail[],
  overrides: Partial<DashboardSummary> = {},
): DashboardSummary {
  const active = accounts.filter((a) => !a.deleted_at);
  return {
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
    timezone: 'UTC',
    month_from: '2026-11-01',
    month_to: '2026-12-01',
    ...overrides,
  };
}

export function buildAuditIntegrity(
  overrides: Partial<AuditIntegrityResponse> = {},
): AuditIntegrityResponse {
  return {
    valid: true,
    total_events: 2,
    latest_seq: 2,
    latest_hash: 'a'.repeat(64),
    broken_seq: null,
    reason: null,
    retention_days: 365,
    ...overrides,
  };
}

export function buildBackupStatus(
  overrides: Partial<BackupStatus> = {},
): BackupStatus {
  return {
    state: 'success',
    last_attempt_at: '2026-11-25T02:30:00Z',
    last_success_at: '2026-11-25T02:30:00Z',
    offsite: 'success',
    ...overrides,
  };
}

export function buildVersionState(
  overrides: Partial<VersionState> = {},
): VersionState {
  return {
    version: '1.3.0',
    schema_version: '0004',
    ...overrides,
  };
}

export type RecordedRequest = {
  method: string;
  pathname: string;
  search: string;
  csrfHeader: string | null;
  bodyText: string;
  status: number;
};

export type StatefulApiServerOptions = {
  sessionState?: SessionResponse['state'];
  stepUpTotpRequired?: boolean;
  adminPassword?: string;
  accounts?: AccountDetail[];
  accountPasswords?: Record<string, string>;
  tags?: TagResponse[];
  trashCount?: number;
  idleMinutes?: number;
  backupStatus?: BackupStatus;
  failNextCsvPreview?: boolean;
};

/**
 * 强类型 OpenAPI 契约 + 有状态 CSRF 轮换模拟服务端（Wave 1）。
 * 严格校验写接口 CSRF、Step-Up TOTP 防重放、恢复邮箱 XOR、row_version CAS 与 CSV 一次性 receipt。
 */
export function createStatefulApiServer(
  options: StatefulApiServerOptions = {},
) {
  let csrfCounter = 1;
  const nextCsrf = () =>
    `csrf-stateful-${String(++csrfCounter).padStart(4, '0')}`;

  const adminPassword = options.adminPassword ?? 'Wave1AdminPass#2026';
  let session: SessionResponse = buildSessionResponse({
    state: options.sessionState ?? 'authenticated',
    csrf_token: 'csrf-stateful-0001',
    step_up_totp_required: options.stepUpTotpRequired ?? true,
  });

  const csrfHistory: string[] = [session.csrf_token];
  const usedTotpCodes = new Set<string>();
  const requests: RecordedRequest[] = [];

  const tags: TagResponse[] = options.tags ? [...options.tags] : [buildTag()];
  const accounts = new Map<string, AccountDetail>();
  for (const acc of options.accounts ?? [buildAccountDetail()]) {
    accounts.set(acc.id, { ...acc });
  }
  const accountPasswords = new Map<string, string>(
    Object.entries(options.accountPasswords ?? {}),
  );

  const sessions: SessionItem[] = [
    {
      id: 'sess-current-01',
      current: true,
      state: 'valid',
      auth_level: 'authenticated',
      created_at: DEFAULT_ISO,
      last_seen_at: DEFAULT_ISO,
      expires_at: session.expires_at,
      idle_expires_at: session.idle_expires_at,
      revoked_at: null,
      ip_address: '127.0.0.1',
    },
    {
      id: 'sess-other-02',
      current: false,
      state: 'valid',
      auth_level: 'authenticated',
      created_at: DEFAULT_ISO,
      last_seen_at: DEFAULT_ISO,
      expires_at: session.expires_at,
      idle_expires_at: session.idle_expires_at,
      revoked_at: null,
      ip_address: '10.0.0.18',
    },
  ];

  const audits: AuditItem[] = [
    {
      id: 'audit-01',
      seq: 1,
      event_hash: '1'.repeat(64),
      event_type: 'login_success',
      account_id: null,
      session_id: 'sess-current-01',
      ip_address: '127.0.0.1',
      operation: 'login',
      created_at: DEFAULT_ISO,
    },
  ];

  let idleMinutes = options.idleMinutes ?? 15;
  const currentBackupStatus: BackupStatus =
    options.backupStatus ?? buildBackupStatus();
  const trashCount = options.trashCount ?? 4;
  let failNextCsvPreview = options.failNextCsvPreview ?? false;

  const csvReceipts = new Map<
    string,
    { raw: string; rows: number; consumed: boolean }
  >();

  const recordAudit = (
    eventType: string,
    operation: string | null,
    accountId: string | null = null,
  ) => {
    const seq = audits.length + 1;
    audits.unshift({
      id: `audit-${String(seq).padStart(2, '0')}`,
      seq,
      event_hash: String(seq % 10).repeat(64),
      event_type: eventType,
      account_id: accountId,
      session_id: 'sess-current-01',
      ip_address: '127.0.0.1',
      operation,
      created_at: new Date().toISOString(),
    });
  };

  const rotateCsrf = () => {
    session = {
      ...session,
      csrf_token: nextCsrf(),
      server_time: new Date().toISOString(),
    };
    csrfHistory.push(session.csrf_token);
  };

  const isReauthActive = () =>
    Boolean(
      session.reauthenticated_until &&
      Date.parse(session.reauthenticated_until) > Date.now(),
    );

  const isMfaReauthActive = () =>
    Boolean(
      session.mfa_reauthenticated_until &&
      Date.parse(session.mfa_reauthenticated_until) > Date.now(),
    );

  const fetchMock = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const req =
      input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const method = req.method.toUpperCase();
    const csrfHeader = req.headers.get('x-csrf-token');
    const bodyText =
      method === 'GET' || method === 'HEAD' ? '' : await req.clone().text();

    const respond = (body: unknown, status = 200): Response => {
      requests.push({
        method,
        pathname,
        search: url.search,
        csrfHeader,
        bodyText,
        status,
      });
      return jsonResponse(body, status);
    };

    // 1. Session bootstrap (read-only)
    if (method === 'GET' && pathname === '/api/v1/auth/session') {
      return respond(session, 200);
    }

    if (session.state !== 'authenticated') {
      return respond(
        buildErrorResponse('UNAUTHENTICATED', '请先登录管理员账号'),
        401,
      );
    }

    // 2. 写请求严格校验当前 CSRF Token（绝不允许过期的旧 Token 通过）
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method)) {
      if (!csrfHeader || csrfHeader !== session.csrf_token) {
        return respond(
          buildErrorResponse('CSRF_INVALID', '安全令牌无效或已过期'),
          403,
        );
      }
    }

    // 3. Auth endpoints
    if (method === 'POST' && pathname === '/api/v1/auth/activity') {
      session = {
        ...session,
        server_time: new Date().toISOString(),
        idle_expires_at: new Date(
          Date.now() + idleMinutes * 60_000,
        ).toISOString(),
      };
      return respond(session, 200);
    }

    if (method === 'POST' && pathname === '/api/v1/auth/reverify') {
      const payload = JSON.parse(bodyText || '{}') as {
        password?: string;
        totp_code?: string;
      };
      if (payload.password !== adminPassword) {
        return respond(
          buildErrorResponse('INVALID_CREDENTIALS', '管理员密码错误'),
          401,
        );
      }
      if (payload.totp_code) {
        if (usedTotpCodes.has(payload.totp_code)) {
          return respond(
            buildErrorResponse(
              'INVALID_CREDENTIALS',
              '验证码已使用，请等待刷新',
            ),
            401,
          );
        }
        usedTotpCodes.add(payload.totp_code);
      } else if (session.step_up_totp_required) {
        return respond(
          buildErrorResponse('TOTP_REQUIRED', '请输入动态验证码完成二次认证'),
          403,
        );
      }
      const until = new Date(Date.now() + 300_000).toISOString();
      session = {
        ...session,
        reauthenticated_until: until,
        mfa_reauthenticated_until: payload.totp_code
          ? until
          : session.mfa_reauthenticated_until,
      };
      rotateCsrf();
      recordAudit('password_reverified', 'reverify');
      return respond(session, 200);
    }

    if (
      method === 'POST' &&
      pathname === '/api/v1/auth/totp/regenerate-recovery-codes'
    ) {
      if (!isReauthActive()) {
        return respond(
          buildErrorResponse('REAUTH_REQUIRED', '缺少有效最近重新验证窗口'),
          403,
        );
      }
      const payload = JSON.parse(bodyText || '{}') as {
        password?: string;
        totp_code?: string;
      };
      if (payload.password !== adminPassword) {
        return respond(
          buildErrorResponse('INVALID_CREDENTIALS', '管理员密码错误'),
          401,
        );
      }
      if (!payload.totp_code || usedTotpCodes.has(payload.totp_code)) {
        return respond(
          buildErrorResponse(
            'INVALID_CREDENTIALS',
            '验证码无效或已使用，禁止重放动态验证码',
          ),
          401,
        );
      }
      usedTotpCodes.add(payload.totp_code);
      rotateCsrf();
      recordAudit('recovery_codes_regenerated', 'regenerate-recovery-codes');
      const result: RecoveryResponse = {
        session,
        recovery_codes: [
          'REC1-WAVE1-AAAA',
          'REC2-WAVE1-BBBB',
          'REC3-WAVE1-CCCC',
          'REC4-WAVE1-DDDD',
        ],
      };
      return respond(result, 200);
    }

    if (method === 'POST' && pathname === '/api/v1/auth/password') {
      if (
        !isReauthActive() ||
        (session.step_up_totp_required && !isMfaReauthActive())
      ) {
        return respond(
          buildErrorResponse(
            'REAUTH_REQUIRED',
            '修改管理员密码前需先完成二次认证',
          ),
          403,
        );
      }
      const payload = JSON.parse(bodyText || '{}') as {
        password?: string;
        new_password?: string;
      };
      if (payload.password !== adminPassword) {
        return respond(
          buildErrorResponse('INVALID_CREDENTIALS', '当前密码不正确'),
          401,
        );
      }
      if (!payload.new_password || payload.new_password.length < 12) {
        return respond(
          buildErrorResponse('WEAK_PASSWORD', '新密码长度不足 12 位'),
          422,
        );
      }
      recordAudit('admin_password_changed', 'password_change');
      const ok: ActionResponse = { status: 'ok' };
      return respond(ok, 200);
    }

    if (method === 'GET' && pathname === '/api/v1/auth/sessions') {
      const page: SessionPage = {
        items: sessions,
        total: sessions.length,
        page: 1,
        page_size: 20,
      };
      return respond(page, 200);
    }

    if (method === 'DELETE' && pathname === '/api/v1/auth/sessions/others') {
      for (const s of sessions) {
        if (!s.current) {
          s.state = 'revoked';
          s.revoked_at = new Date().toISOString();
        }
      }
      recordAudit('sessions_revoked_others', 'revoke-others');
      const ok: ActionResponse = { status: 'ok' };
      return respond(ok, 200);
    }

    // 4. Settings & System endpoints
    if (method === 'GET' && pathname === '/api/v1/settings') {
      const state: SettingsState = {
        idle_minutes: idleMinutes,
        max_idle_minutes: 720,
      };
      return respond(state, 200);
    }

    if (method === 'PATCH' && pathname === '/api/v1/settings/idle') {
      if (!isReauthActive()) {
        return respond(
          buildErrorResponse('REAUTH_REQUIRED', '修改空闲超时需重新验证'),
          403,
        );
      }
      const payload = JSON.parse(bodyText || '{}') as IdleSetting;
      idleMinutes = payload.idle_minutes;
      session = { ...session, idle_timeout_seconds: idleMinutes * 60 };
      recordAudit('settings_updated', 'idle_minutes');
      const state: SettingsState = {
        idle_minutes: idleMinutes,
        max_idle_minutes: 720,
      };
      return respond(state, 200);
    }

    if (method === 'GET' && pathname === '/api/v1/system/version') {
      return respond(buildVersionState(), 200);
    }

    if (method === 'GET' && pathname === '/api/v1/system/backup-status') {
      return respond(currentBackupStatus, 200);
    }

    if (method === 'GET' && pathname === '/api/v1/audit-events') {
      const page: AuditPage = {
        items: audits,
        total: audits.length,
        page: 1,
        page_size: 30,
        event_types: [...new Set(audits.map((a) => a.event_type))],
      };
      return respond(page, 200);
    }

    if (method === 'GET' && pathname === '/api/v1/audit-events/integrity') {
      return respond(
        buildAuditIntegrity({
          total_events: audits.length,
          latest_seq: audits[0]?.seq ?? null,
          latest_hash: audits[0]?.event_hash ?? null,
        }),
        200,
      );
    }

    // 5. Tags & Dashboard
    if (method === 'GET' && pathname === '/api/v1/tags') {
      return respond(tags, 200);
    }

    if (method === 'GET' && pathname === '/api/v1/dashboard/summary') {
      return respond(buildDashboardSummary([...accounts.values()]), 200);
    }

    // 6. Accounts endpoints
    if (method === 'GET' && pathname === '/api/v1/accounts') {
      const deletedParam = url.searchParams.get('deleted');
      const archivedParam = url.searchParams.get('archived');
      if (deletedParam === 'true') {
        return respond(
          buildAccountPage([], { total: trashCount, page_size: 1 }),
          200,
        );
      }
      let list = [...accounts.values()].filter((a) => !a.deleted_at);
      if (archivedParam === 'true') {
        list = list.filter((a) => Boolean(a.archived_at));
      } else if (archivedParam === 'false') {
        list = list.filter((a) => !a.archived_at);
      }
      return respond(
        buildAccountPage(list.map(toAccountSummary), { total: list.length }),
        200,
      );
    }

    const detailMatch = /^\/api\/v1\/accounts\/([^/]+)$/.exec(pathname);
    if (detailMatch) {
      const id = decodeURIComponent(detailMatch[1]);
      const current = accounts.get(id);
      if (!current) {
        return respond(
          buildErrorResponse('ACCOUNT_NOT_FOUND', '账号不存在'),
          404,
        );
      }
      if (method === 'GET') {
        return respond(current, 200);
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(bodyText || '{}') as AccountPatchWritable;
        if (patch.row_version !== current.row_version) {
          return respond(
            buildErrorResponse('ROW_VERSION_CONFLICT', '记录已被其他操作修改'),
            409,
          );
        }
        const nextRecAcc =
          patch.recovery_account_id !== undefined
            ? patch.recovery_account_id
            : current.recovery_account_id;
        const nextRecExt =
          patch.recovery_email_external !== undefined
            ? patch.recovery_email_external
            : current.recovery_email_external;
        if (nextRecAcc && nextRecExt) {
          return respond(
            buildErrorResponse(
              'RECOVERY_INVALID',
              '库内关联辅助账号与外部辅助邮箱只能二选一',
            ),
            422,
          );
        }
        if (patch.notes && patch.notes.length > 20_000) {
          return respond(
            buildErrorResponse(
              'VALIDATION_ERROR',
              '备注长度超出 20000 字符上限',
            ),
            422,
          );
        }
        const linked = nextRecAcc ? accounts.get(nextRecAcc) : undefined;
        const updated: AccountDetail = {
          ...current,
          gmail_email: patch.gmail_email ?? current.gmail_email,
          recovery_account_id: nextRecAcc ?? null,
          recovery_email_external: nextRecExt ?? null,
          recovery_email:
            linked?.gmail_email ?? nextRecExt ?? current.recovery_email,
          phone: patch.phone !== undefined ? patch.phone : current.phone,
          status: patch.status ?? current.status,
          two_factor_status:
            patch.two_factor_status ?? current.two_factor_status,
          purpose:
            patch.purpose !== undefined ? patch.purpose : current.purpose,
          notes: patch.notes !== undefined ? patch.notes : current.notes,
          row_version: current.row_version + 1,
          updated_at: new Date().toISOString(),
        };
        accounts.set(id, updated);
        recordAudit('account_updated', 'patch', id);
        return respond(updated, 200);
      }
    }

    const actionMatch =
      /^\/api\/v1\/accounts\/([^/]+)\/(mark-logged-in|mark-verified|reveal-password)$/.exec(
        pathname,
      );
    if (method === 'POST' && actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      const current = accounts.get(id);
      if (!current) {
        return respond(
          buildErrorResponse('ACCOUNT_NOT_FOUND', '账号不存在'),
          404,
        );
      }
      if (action === 'reveal-password') {
        if (
          !isReauthActive() ||
          (session.step_up_totp_required && !isMfaReauthActive())
        ) {
          return respond(
            buildErrorResponse('REAUTH_REQUIRED', '查看密码前需完成二次验证'),
            403,
          );
        }
        const secret: PasswordResponse = {
          password: accountPasswords.get(id) ?? 'SynthAccountSecret!2026',
        };
        recordAudit('password_revealed', 'reveal-password', id);
        return respond(secret, 200);
      }
      const payload = JSON.parse(bodyText || '{}') as { row_version: number };
      if (payload.row_version !== current.row_version) {
        return respond(
          buildErrorResponse('ROW_VERSION_CONFLICT', '行版本已过期'),
          409,
        );
      }
      const nowIso = new Date().toISOString();
      const updated: AccountDetail = {
        ...current,
        last_login_at:
          action === 'mark-logged-in' ? nowIso : current.last_login_at,
        last_verified_at:
          action === 'mark-verified' ? nowIso : current.last_verified_at,
        row_version: current.row_version + 1,
        updated_at: nowIso,
      };
      accounts.set(id, updated);
      recordAudit('account_updated', action, id);
      return respond(updated, 200);
    }

    // 7. CSV Import / Commit
    if (method === 'POST' && pathname === '/api/v1/imports/csv/preview') {
      if (failNextCsvPreview) {
        failNextCsvPreview = false;
        return respond(
          buildErrorResponse('REAUTH_REQUIRED', '请先重新验证管理员身份'),
          403,
        );
      }
      const lines = bodyText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const dataRows = Math.max(0, lines.length - 1);
      const receiptId = `rcpt-${crypto.randomUUID().slice(0, 12)}`;
      csvReceipts.set(receiptId, {
        raw: bodyText,
        rows: dataRows,
        consumed: false,
      });
      const preview: CsvPreview = {
        receipt_id: receiptId,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
        mapping: {
          gmail_email: 0,
          password: 1,
          recovery_email: 2,
          phone: 3,
          status: 4,
          two_factor_status: 5,
        },
        strategy: 'skip',
        columns: [
          { index: 0, suggested_field: 'gmail_email' },
          { index: 1, suggested_field: 'password' },
          { index: 2, suggested_field: 'recovery_email' },
          { index: 3, suggested_field: 'phone' },
          { index: 4, suggested_field: 'status' },
          { index: 5, suggested_field: 'two_factor_status' },
        ],
        rows: Array.from({ length: dataRows }, (_, idx) => ({
          row: idx + 2,
          action: 'create' as const,
        })),
        errors: [],
      };
      return respond(preview, 200);
    }

    if (method === 'POST' && pathname === '/api/v1/imports/csv/commit') {
      const receiptId = url.searchParams.get('receipt_id') ?? '';
      const entry = csvReceipts.get(receiptId);
      if (!entry || entry.consumed || entry.raw !== bodyText) {
        const rejected: CsvCommit = {
          status: 'rejected',
          errors: [
            {
              row: 1,
              field: 'file',
              reason: '确认凭据无效、已消耗或与预览文件不一致',
            },
          ],
        };
        return respond(rejected, 409);
      }
      entry.consumed = true;
      recordAudit('csv_imported', 'csv-commit');
      const committed: CsvCommit = {
        status: 'committed',
        created: entry.rows,
        updated: 0,
        skipped: 0,
        errors: [],
      };
      return respond(committed, 200);
    }

    throw new Error(
      `[api-contract] Unexpected API call: ${method} ${pathname}${url.search}`,
    );
  };

  return {
    fetchMock,
    requests,
    csrfHistory,
    usedTotpCodes,
    getCurrentCsrf: () => session.csrf_token,
    getAccount: (id: string) => accounts.get(id),
    getIdleMinutes: () => idleMinutes,
  };
}
