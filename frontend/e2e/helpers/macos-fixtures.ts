import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export const FIXED_NOW_ISO = '2026-11-25T10:00:00.000Z';
export const ALT_NOW_ISO = '2027-04-18T03:27:45.000Z';

export const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1728x1117', width: 1728, height: 1117 },
] as const;

export const OPACITIES = [35, 60, 90] as const;

export type MacosPageId =
  'accounts' | 'account-detail' | 'settings' | 'csv-import';

export const PRIMARY_ACCOUNT_ID = 'acc-0000-0000-0000-000000000001';
export const SECONDARY_ACCOUNT_ID = 'acc-0000-0000-0000-000000000002';

export const MACOS_PAGES: readonly {
  id: MacosPageId;
  label: string;
  path: string;
}[] = [
  { id: 'accounts', label: '账号列表', path: '/accounts' },
  {
    id: 'account-detail',
    label: '账号详情',
    path: `/accounts/${PRIMARY_ACCOUNT_ID}`,
  },
  { id: 'settings', label: '系统设置', path: '/settings/security' },
  { id: 'csv-import', label: 'CSV 导入', path: '/transfers/csv' },
];

export const SENTINELS = {
  accountPassword: 'SENTINEL_ACC_PWD_9911_DO_NOT_LEAK!',
  adminPassword: 'SENTINEL_ADMIN_PWD_8822_DO_NOT_LEAK!',
  newAdminPassword: 'SENTINEL_NEW_ADMIN_PWD_5511_DO_NOT_LEAK!',
  totpCode: '654321',
  csvPassword: 'SENTINEL_CSV_PWD_7733_DO_NOT_LEAK!',
  recoveryCode: 'SENTINEL-REC-CODE-6644-DO-NOT-LEAK',
} as const;

export type PageMode = 'ready' | 'loading' | 'empty' | 'error';

export type DeterministicAppOptions = {
  nowIso?: string;
  randomIds?: boolean;
  navAlpha?: number;
  reducedMotion?: boolean;
  pageMode?: PageMode;
  reverified?: boolean;
  stepUpTotpRequired?: boolean;
};

function makeDeterministicId(
  prefix: string,
  index: number,
  randomIds: boolean,
) {
  if (randomIds) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-0000-0000-0000-${String(index).padStart(12, '0')}`;
}

function makeHash(seed: number, randomIds: boolean) {
  if (randomIds) {
    return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
  }
  return `${String(seed).padStart(4, '0')}9e7c1a4b6d8f2031e5a7c9b4d6f80123456789abcdef0123456789abcdef`.slice(
    0,
    64,
  );
}

export function buildSyntheticCsvPayload(
  secret: string = SENTINELS.csvPassword,
  options: { withErrors?: boolean; filename?: string } = {},
) {
  const rows = options.withErrors
    ? [
        'gmail_email,password,recovery_email,phone,status,two_factor_status,purpose',
        `invalid-email-row,${secret},bad.bak@example.test,+86 13800001111,normal,enabled,格式错误行`,
        `csv.valid@gmail.com,${secret}2,valid.bak@example.test,+86 13900002222,normal,enabled,有效记录`,
      ]
    : [
        'gmail_email,password,recovery_email,phone,status,two_factor_status,purpose',
        `csv.alpha@gmail.com,${secret},alpha.bak@example.test,+86 13812345678,normal,enabled,主工作区同步`,
        `csv.beta@gmail.com,${secret}2,beta.bak@example.test,+86 13987654321,pending_verification,disabled,渠道备份`,
      ];

  return {
    name: options.filename ?? 'synthetic_accounts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rows.join('\r\n'), 'utf-8'),
  };
}

export async function installDeterministicMacosApp(
  page: Page,
  options: DeterministicAppOptions = {},
) {
  const nowIso = options.nowIso ?? FIXED_NOW_ISO;
  const nowMs = Date.parse(nowIso);
  const randomIds = options.randomIds ?? false;
  let pageMode: PageMode = options.pageMode ?? 'ready';
  let csrfToken = randomIds
    ? `csrf-${crypto.randomUUID()}`
    : 'csrf-fixed-000000000001';
  let reauthenticatedUntil: string | null = options.reverified
    ? new Date(nowMs + 300_000).toISOString()
    : null;
  let mfaReauthenticatedUntil: string | null = options.reverified
    ? new Date(nowMs + 300_000).toISOString()
    : null;
  let idleMinutes = 15;
  const pendingResolvers: Array<() => void> = [];

  await page.clock.setFixedTime(new Date(nowMs));

  if (options.reducedMotion) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }

  if (typeof options.navAlpha === 'number') {
    await page.addInitScript((alpha) => {
      if (window.localStorage.getItem('gm_nav_alpha') === null) {
        window.localStorage.setItem('gm_nav_alpha', String(alpha));
      }
    }, options.navAlpha);
  }

  const tagWork = {
    id: makeDeterministicId('tag', 1, randomIds),
    name: '工作主用',
    created_at: new Date(nowMs - 86_400_000 * 30).toISOString(),
  };
  const tagBackup = {
    id: makeDeterministicId('tag', 2, randomIds),
    name: '安全备份',
    created_at: new Date(nowMs - 86_400_000 * 20).toISOString(),
  };
  const tagCloud = {
    id: makeDeterministicId('tag', 3, randomIds),
    name: '云服务',
    created_at: new Date(nowMs - 86_400_000 * 10).toISOString(),
  };
  const tags = [tagWork, tagBackup, tagCloud];

  const primaryId = randomIds
    ? makeDeterministicId('acc', 1, true)
    : PRIMARY_ACCOUNT_ID;
  const secondaryId = randomIds
    ? makeDeterministicId('acc', 2, true)
    : SECONDARY_ACCOUNT_ID;
  const thirdId = makeDeterministicId('acc', 3, randomIds);

  const accounts = [
    {
      id: primaryId,
      account_no: 'GM-000001',
      gmail_email: 'ops.primary@gmail.com',
      password: SENTINELS.accountPassword,
      registered_at: new Date(nowMs - 86_400_000 * 180).toISOString(),
      recovery_account_id: null as string | null,
      recovery_email_external: 'ops.recovery@example.test',
      recovery_email: 'ops.recovery@example.test',
      status: 'normal' as const,
      two_factor_status: 'enabled' as const,
      purpose: '主控运维与通知接收',
      tags: [tagWork, tagBackup],
      last_login_at: new Date(nowMs - 3_600_000 * 2).toISOString(),
      last_verified_at: new Date(nowMs - 86_400_000 * 2).toISOString(),
      password_changed_at: new Date(nowMs - 86_400_000 * 45).toISOString(),
      archived_at: null as string | null,
      deleted_at: null as string | null,
      row_version: 3,
      phone: '+86 138 0013 8001',
      notes: '用于日常系统告警与安全核验（合成测试数据）',
      created_at: new Date(nowMs - 86_400_000 * 180).toISOString(),
      updated_at: new Date(nowMs - 3_600_000 * 5).toISOString(),
    },
    {
      id: secondaryId,
      account_no: 'GM-000002',
      gmail_email: 'billing.archive@gmail.com',
      password: `${SENTINELS.accountPassword}#2`,
      registered_at: new Date(nowMs - 86_400_000 * 95).toISOString(),
      recovery_account_id: null as string | null,
      recovery_email_external: 'finance.bak@example.test',
      recovery_email: 'finance.bak@example.test',
      status: 'pending_verification' as const,
      two_factor_status: 'enabled' as const,
      purpose: '账单与域名续费通知',
      tags: [tagCloud],
      last_login_at: new Date(nowMs - 86_400_000 * 1).toISOString(),
      last_verified_at: new Date(nowMs - 86_400_000 * 35).toISOString(),
      password_changed_at: new Date(nowMs - 86_400_000 * 60).toISOString(),
      archived_at: null as string | null,
      deleted_at: null as string | null,
      row_version: 2,
      phone: '+86 139 0013 9002',
      notes: '待完成例行登录核验',
      created_at: new Date(nowMs - 86_400_000 * 95).toISOString(),
      updated_at: new Date(nowMs - 86_400_000 * 1).toISOString(),
    },
    {
      id: thirdId,
      account_no: 'GM-000003',
      gmail_email: 'sandbox.restricted@gmail.com',
      password: `${SENTINELS.accountPassword}#3`,
      registered_at: new Date(nowMs - 86_400_000 * 40).toISOString(),
      recovery_account_id: null as string | null,
      recovery_email_external: 'sandbox.bak@example.test',
      recovery_email: 'sandbox.bak@example.test',
      status: 'restricted' as const,
      two_factor_status: 'disabled' as const,
      purpose: '隔离测试与通道验证',
      tags: [tagBackup],
      last_login_at: new Date(nowMs - 86_400_000 * 12).toISOString(),
      last_verified_at: null as string | null,
      password_changed_at: null as string | null,
      archived_at: null as string | null,
      deleted_at: null as string | null,
      row_version: 1,
      phone: null as string | null,
      notes: '风控状态排查中',
      created_at: new Date(nowMs - 86_400_000 * 40).toISOString(),
      updated_at: new Date(nowMs - 86_400_000 * 4).toISOString(),
    },
  ];

  const sessions = [
    {
      id: makeDeterministicId('sess', 1, randomIds),
      current: true,
      state: 'valid' as const,
      auth_level: 'authenticated' as const,
      created_at: new Date(nowMs - 3_600_000 * 3).toISOString(),
      last_seen_at: new Date(nowMs - 60_000).toISOString(),
      expires_at: new Date(nowMs + 43_200_000).toISOString(),
      idle_expires_at: new Date(nowMs + idleMinutes * 60_000).toISOString(),
      revoked_at: null as string | null,
      ip_address: '192.0.2.10',
    },
    {
      id: makeDeterministicId('sess', 2, randomIds),
      current: false,
      state: 'valid' as const,
      auth_level: 'authenticated' as const,
      created_at: new Date(nowMs - 86_400_000).toISOString(),
      last_seen_at: new Date(nowMs - 1_800_000).toISOString(),
      expires_at: new Date(nowMs + 36_000_000).toISOString(),
      idle_expires_at: new Date(nowMs + 600_000).toISOString(),
      revoked_at: null as string | null,
      ip_address: '192.0.2.25',
    },
  ];

  const audits = [
    {
      id: makeDeterministicId('aud', 101, randomIds),
      seq: 101,
      event_hash: makeHash(101, randomIds),
      event_type: 'account_updated',
      account_id: primaryId,
      session_id: sessions[0].id,
      ip_address: '192.0.2.10',
      operation: 'patch',
      created_at: new Date(nowMs - 3_600_000 * 2).toISOString(),
    },
    {
      id: makeDeterministicId('aud', 100, randomIds),
      seq: 100,
      event_hash: makeHash(100, randomIds),
      event_type: 'csv_imported',
      account_id: null,
      session_id: sessions[0].id,
      ip_address: '192.0.2.10',
      operation: 'csv_commit',
      created_at: new Date(nowMs - 86_400_000).toISOString(),
    },
    {
      id: makeDeterministicId('aud', 99, randomIds),
      seq: 99,
      event_hash: makeHash(99, randomIds),
      event_type: 'account_created',
      account_id: primaryId,
      session_id: sessions[0].id,
      ip_address: '192.0.2.10',
      operation: 'create',
      created_at: new Date(nowMs - 86_400_000 * 2).toISOString(),
    },
  ];

  const stripSummary = (acc: (typeof accounts)[number]) => {
    const { password: _p, phone: _ph, notes: _n, ...rest } = acc;
    return rest;
  };
  const stripDetail = (acc: (typeof accounts)[number]) => {
    const { password: _p, ...rest } = acc;
    return rest;
  };

  const sessionPayload = () => ({
    state: 'authenticated',
    idle_timeout_seconds: idleMinutes * 60,
    server_time: nowIso,
    csrf_token: csrfToken,
    expires_at: new Date(nowMs + 43_200_000).toISOString(),
    idle_expires_at: new Date(nowMs + idleMinutes * 60_000).toISOString(),
    reauthenticated_until: reauthenticatedUntil,
    mfa_reauthenticated_until: mfaReauthenticatedUntil,
    step_up_totp_required: Boolean(options.stepUpTotpRequired),
    totp_enabled: true,
    webauthn_enabled: false,
  });

  const holdIfLoading = async () => {
    if (pageMode !== 'loading') return false;
    await new Promise<void>((resolve) => {
      pendingResolvers.push(resolve);
    });
    return true;
  };

  const errorJson = (code: string, message: string) => ({
    error: { code, message, details: {} },
    request_id: makeDeterministicId('req', 999, randomIds),
  });

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');

    const fulfillJson = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify(body),
      });

    if (path === '/auth/session' && method === 'GET') {
      return fulfillJson(sessionPayload());
    }
    if (path === '/auth/activity' && method === 'POST') {
      return fulfillJson(sessionPayload());
    }
    if (path === '/auth/logout' && method === 'POST') {
      return fulfillJson({ status: 'ok' });
    }
    if (path === '/auth/reverify' && method === 'POST') {
      const body = req.postDataJSON() as { password?: string };
      if (body.password !== SENTINELS.adminPassword) {
        return fulfillJson(
          errorJson('AUTH_FAILED', '验证失败或暂时受限，请稍后重试'),
          401,
        );
      }
      reauthenticatedUntil = new Date(nowMs + 300_000).toISOString();
      mfaReauthenticatedUntil = new Date(nowMs + 300_000).toISOString();
      csrfToken = randomIds
        ? `csrf-${crypto.randomUUID()}`
        : 'csrf-fixed-rotated-0002';
      return fulfillJson(sessionPayload());
    }
    if (path === '/auth/password' && method === 'POST') {
      return fulfillJson({ status: 'ok' });
    }
    if (path === '/auth/totp/regenerate-recovery-codes' && method === 'POST') {
      csrfToken = randomIds
        ? `csrf-${crypto.randomUUID()}`
        : 'csrf-fixed-rotated-0003';
      return fulfillJson({
        session: sessionPayload(),
        recovery_codes: Array.from({ length: 10 }, (_, i) =>
          i === 0
            ? SENTINELS.recoveryCode
            : `SYNTH-REC-${String(i + 1).padStart(2, '0')}-99887766`,
        ),
      });
    }

    // Dashboard & tags
    if (path === '/dashboard/summary' && method === 'GET') {
      if (pageMode === 'empty') {
        return fulfillJson({
          total: 0,
          normal: 0,
          pending_verification: 0,
          abnormal: 0,
          added_this_month: 0,
          unverified_over_30_days: 0,
          timezone: 'Asia/Shanghai',
          month_from: nowIso,
          month_to: nowIso,
        });
      }
      return fulfillJson({
        total: accounts.length,
        normal: accounts.filter((a) => a.status === 'normal').length,
        pending_verification: accounts.filter(
          (a) => a.status === 'pending_verification',
        ).length,
        abnormal: accounts.filter((a) => a.status === 'restricted').length,
        added_this_month: 2,
        unverified_over_30_days: 1,
        timezone: 'Asia/Shanghai',
        month_from: nowIso,
        month_to: nowIso,
      });
    }

    if (path === '/tags' && method === 'GET') {
      return fulfillJson(pageMode === 'empty' ? [] : tags);
    }

    if (path === '/apps' && method === 'GET') {
      return fulfillJson([]);
    }

    if (path === '/apps/usage' && method === 'GET') {
      return fulfillJson({ items: [], total_accounts: accounts.length });
    }

    if (path === '/auth/webauthn/credentials' && method === 'GET') {
      return fulfillJson([]);
    }

    if (path === '/dashboard/registration-trend' && method === 'GET') {
      return fulfillJson({
        timezone: 'Asia/Shanghai',
        months: 12,
        items: [
          {
            month: '2026-11',
            count: accounts.length,
            cumulative: accounts.length,
          },
        ],
      });
    }

    if (path === '/dashboard/status-distribution' && method === 'GET') {
      return fulfillJson({
        total: accounts.length,
        statuses: [{ status: 'normal', count: accounts.length }],
        two_factor: [{ two_factor_status: 'enabled', count: accounts.length }],
        top_tags: [],
      });
    }

    if (path === '/dashboard/recovery-email-usage' && method === 'GET') {
      return fulfillJson({
        total_accounts: accounts.length,
        total_recovery_emails: 0,
        items: [],
        others_count: 0,
      });
    }

    if (path === '/dashboard/insights' && method === 'GET') {
      return fulfillJson({
        disabled_2fa_count: 0,
        unknown_2fa_count: 0,
        pending_verification_count: 0,
        risk_status_count: 0,
        unverified_over_30_days: 0,
        inactive_login_over_90_days: 0,
        password_stale_over_180_days: 0,
        no_recovery_email_count: 0,
        app_risk_account_count: 0,
        concentrated_recovery_emails: [],
        no_purpose_count: 0,
        no_tags_count: 0,
        inactive_with_active_apps_count: 0,
        external_recovery_matches_internal: [],
        backup_state: 'success',
        backup_offsite: 'success',
        backup_last_success_at: nowIso,
        recent_auth_failures_7d: 0,
        generated_at: nowIso,
      });
    }

    if (path === '/accounts/options' && method === 'GET') {
      return fulfillJson({
        items:
          pageMode === 'empty'
            ? []
            : accounts.map((a) => ({
                id: a.id,
                account_no: a.account_no,
                gmail_email: a.gmail_email,
              })),
        total: pageMode === 'empty' ? 0 : accounts.length,
        page: 1,
        page_size: 30,
      });
    }

    // Accounts list
    if (path === '/accounts' && method === 'GET') {
      if (await holdIfLoading()) {
        // Released after loading verification -> fall through to current pageMode
      }
      if (pageMode === 'error') {
        return fulfillJson(
          errorJson('INTERNAL_ERROR', '账号列表服务暂时不可用，请稍后重试'),
          500,
        );
      }
      if (pageMode === 'empty' || url.searchParams.get('deleted') === 'true') {
        return fulfillJson({
          items: [],
          total: 0,
          page: 1,
          page_size: 30,
          max_page_size: 100,
        });
      }
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const status = url.searchParams.get('status');
      let filtered = [...accounts];
      if (status) {
        filtered = filtered.filter((a) => a.status === status);
      }
      if (search) {
        filtered = filtered.filter(
          (a) =>
            a.gmail_email.toLowerCase().includes(search) ||
            a.account_no.toLowerCase().includes(search),
        );
      }
      return fulfillJson({
        items: filtered.map(stripSummary),
        total: filtered.length,
        page: 1,
        page_size: 30,
        max_page_size: 100,
      });
    }

    // Single account endpoints
    const accountMatch = /^\/accounts\/([^/]+)(?:\/(.+))?$/.exec(path);
    if (accountMatch) {
      const [, rawId, subAction] = accountMatch;
      const target =
        accounts.find((a) => a.id === rawId) ??
        (rawId === PRIMARY_ACCOUNT_ID ? accounts[0] : undefined);

      if (!subAction && method === 'GET') {
        if (await holdIfLoading()) {
          // Released
        }
        if (pageMode === 'error') {
          return fulfillJson(
            errorJson('INTERNAL_ERROR', '账号详情读取失败，请重试'),
            500,
          );
        }
        if (pageMode === 'empty' || !target) {
          return fulfillJson(errorJson('ACCOUNT_NOT_FOUND', '账号不存在'), 404);
        }
        return fulfillJson(stripDetail(target));
      }

      if (!target) {
        return fulfillJson(errorJson('ACCOUNT_NOT_FOUND', '账号不存在'), 404);
      }

      if (subAction === 'reveal-password' && method === 'POST') {
        if (!reauthenticatedUntil) {
          return fulfillJson(
            errorJson('REAUTH_REQUIRED', '请先重新验证管理员密码'),
            403,
          );
        }
        return fulfillJson({ password: target.password });
      }

      if (subAction === 'copy-password-event' && method === 'POST') {
        return fulfillJson({ status: 'ok' });
      }

      if (subAction === 'mark-verified' && method === 'POST') {
        target.last_verified_at = nowIso;
        target.row_version += 1;
        return fulfillJson(stripDetail(target));
      }

      if (!subAction && method === 'PATCH') {
        const body = req.postDataJSON() as Record<string, unknown>;
        if (typeof body.purpose === 'string') target.purpose = body.purpose;
        target.row_version += 1;
        return fulfillJson(stripDetail(target));
      }
    }

    // Settings / sessions / audits / backup / version
    if (path === '/auth/sessions' && method === 'GET') {
      if (await holdIfLoading()) {
        // Released
      }
      if (pageMode === 'error') {
        return fulfillJson(
          errorJson('INTERNAL_ERROR', '会话服务暂时不可用'),
          500,
        );
      }
      if (pageMode === 'empty') {
        return fulfillJson({ items: [], total: 0, page: 1, page_size: 20 });
      }
      return fulfillJson({
        items: sessions,
        total: sessions.length,
        page: 1,
        page_size: 20,
      });
    }

    if (path === '/auth/sessions/others' && method === 'DELETE') {
      return fulfillJson({ status: 'ok' });
    }

    if (path === '/audit-events' && method === 'GET') {
      if (await holdIfLoading()) {
        // Released
      }
      if (pageMode === 'error') {
        return fulfillJson(
          errorJson('INTERNAL_ERROR', '审计日志服务暂时不可用'),
          500,
        );
      }
      if (pageMode === 'empty') {
        return fulfillJson({
          items: [],
          total: 0,
          page: 1,
          page_size: 30,
          event_types: [],
        });
      }
      return fulfillJson({
        items: audits,
        total: audits.length,
        page: 1,
        page_size: 30,
        event_types: ['account_created', 'account_updated', 'csv_imported'],
      });
    }

    if (path === '/audit-events/integrity' && method === 'GET') {
      if (await holdIfLoading()) {
        // Released
      }
      if (pageMode === 'error') {
        return fulfillJson(
          errorJson('INTERNAL_ERROR', '审计完整性检查失败'),
          500,
        );
      }
      return fulfillJson({
        valid: true,
        total_events: pageMode === 'empty' ? 0 : audits.length,
        latest_seq: pageMode === 'empty' ? null : audits[0].seq,
        latest_hash: pageMode === 'empty' ? null : audits[0].event_hash,
        retention_days: 365,
      });
    }

    if (path === '/system/backup-status' && method === 'GET') {
      if (await holdIfLoading()) {
        // Released
      }
      if (pageMode === 'error') {
        return fulfillJson(
          errorJson('INTERNAL_ERROR', '备份状态检查失败'),
          500,
        );
      }
      if (pageMode === 'empty') {
        return fulfillJson({
          state: 'unconfigured',
          offsite: 'unconfigured',
          last_success_at: null,
        });
      }
      return fulfillJson({
        state: 'success',
        offsite: 'success',
        last_success_at: new Date(nowMs - 3_600_000 * 8).toISOString(),
      });
    }

    if (path === '/system/version' && method === 'GET') {
      return fulfillJson({ version: '1.2.0', schema_version: '0004' });
    }

    if (path === '/settings' && method === 'GET') {
      if (await holdIfLoading()) {
        // Released
      }
      if (pageMode === 'error') {
        return fulfillJson(
          errorJson('INTERNAL_ERROR', '系统设置读取失败'),
          500,
        );
      }
      return fulfillJson({ idle_minutes: idleMinutes, max_idle_minutes: 720 });
    }

    if (path === '/settings/idle' && method === 'PATCH') {
      const body = req.postDataJSON() as { idle_minutes: number };
      idleMinutes = body.idle_minutes;
      return fulfillJson({ idle_minutes: idleMinutes, max_idle_minutes: 720 });
    }

    // CSV preview & commit & export
    if (path === '/imports/csv/preview' && method === 'POST') {
      if (await holdIfLoading()) {
        // Released
      }
      if (pageMode === 'error') {
        return fulfillJson(
          errorJson('CSV_INVALID', 'CSV 服务端校验未通过，请修正文件后重试'),
          422,
        );
      }
      const rawText = req.postData() ?? '';
      const lines = rawText
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const headers = (lines[0] ?? '').split(',').map((h) => h.trim());
      const defaultMapping: Record<string, number> = {
        gmail_email: 0,
        password: 1,
        recovery_email: 2,
        phone: 3,
        status: 4,
        two_factor_status: 5,
        purpose: 6,
      };
      const rows: {
        row: number;
        action: 'create' | 'update' | 'skip' | 'error';
      }[] = [];
      const errors: { row: number; field: string; reason: string }[] = [];
      for (let i = 1; i < lines.length; i++) {
        const email = (lines[i].split(',')[0] ?? '').trim();
        if (!email.includes('@')) {
          rows.push({ row: i + 1, action: 'error' });
          errors.push({
            row: i + 1,
            field: 'gmail_email',
            reason: '邮箱格式不正确',
          });
        } else {
          rows.push({ row: i + 1, action: 'create' });
        }
      }
      const receiptId =
        errors.length === 0 ? makeDeterministicId('rcpt', 1, randomIds) : null;
      return fulfillJson({
        receipt_id: receiptId,
        expires_at: receiptId ? new Date(nowMs + 600_000).toISOString() : null,
        mapping: defaultMapping,
        strategy: 'update',
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
      return fulfillJson({
        status: 'committed',
        created: 2,
        updated: 0,
        skipped: 0,
        errors: [],
      });
    }

    if (path === '/exports/csv' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition': 'attachment; filename="accounts-export.csv"',
          'Cache-Control': 'no-store',
        },
        body: 'account_no,gmail_email,status\nGM-000001,ops.primary@gmail.com,normal\n',
      });
    }

    return fulfillJson(
      errorJson(
        'NOT_FOUND',
        `Unhandled deterministic route: ${method} ${path}`,
      ),
      404,
    );
  });

  return {
    primaryId,
    secondaryId,
    accounts,
    sessions,
    audits,
    setPageMode(next: PageMode) {
      pageMode = next;
    },
    releaseLoading() {
      pageMode = 'ready';
      while (pendingResolvers.length > 0) {
        pendingResolvers.shift()?.();
      }
    },
  };
}

export async function waitForStableFontsAndPaint(page: Page) {
  await page.evaluate(async () => {
    if (document.fonts && 'ready' in document.fonts) {
      await document.fonts.ready;
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

export async function openMacosPage(
  page: Page,
  pageId: MacosPageId,
  options: {
    mode?: PageMode;
    accountId?: string;
    populateCsv?: boolean;
    settingsUiStateQuery?: boolean;
  } = {},
) {
  const mode = options.mode ?? 'ready';
  const accountId = options.accountId ?? PRIMARY_ACCOUNT_ID;
  const targetPath =
    pageId === 'accounts'
      ? '/accounts'
      : pageId === 'account-detail'
        ? `/accounts/${accountId}`
        : pageId === 'settings'
          ? options.settingsUiStateQuery && mode !== 'ready'
            ? `/settings/security?ui_state=${mode}`
            : '/settings/security'
          : '/transfers/csv';

  await page.goto(targetPath, { waitUntil: 'load' });
  await expect(page.locator('[data-slot="app-window-shell"]')).toBeVisible();

  if (pageId === 'accounts') {
    if (mode === 'loading') {
      await expect(page.getByText('正在加载账号列表…')).toBeVisible();
    } else if (mode === 'empty') {
      await expect(page.getByText('暂无账号', { exact: true })).toBeVisible();
    } else if (mode === 'error') {
      await expect(page.getByText('账号加载失败')).toBeVisible();
    } else {
      await expect(
        page.getByRole('button', {
          name: 'ops.primary@gmail.com',
          exact: true,
        }),
      ).toBeVisible();
    }
  } else if (pageId === 'account-detail') {
    if (mode === 'loading') {
      await expect(page.getByText('正在加载账号详情…')).toBeVisible();
    } else if (mode === 'empty') {
      await expect(page.getByText('未找到该账号')).toBeVisible();
    } else if (mode === 'error') {
      await expect(page.getByText('账号详情加载失败')).toBeVisible();
    } else {
      await expect(
        page.getByRole('heading', { name: 'ops.primary@gmail.com' }),
      ).toBeVisible();
    }
  } else if (pageId === 'settings') {
    await expect(
      page.getByRole('heading', { level: 1, name: '系统设置' }),
    ).toBeVisible();
    if (mode === 'loading') {
      await expect(
        page.locator('[aria-busy="true"], [data-slot="loading-state"]').first(),
      ).toBeVisible();
    } else if (mode === 'empty') {
      await expect(
        page.getByText(/暂无.*会话|尚未配置备份|暂无.*审计/).first(),
      ).toBeVisible();
    } else if (mode === 'error') {
      await expect(page.getByRole('alert').first()).toBeVisible();
    } else {
      await expect(page.getByText('192.0.2.10').first()).toBeVisible();
    }
  } else if (pageId === 'csv-import') {
    await expect(
      page.getByRole('heading', { level: 1, name: 'CSV 导入 / 批量操作' }),
    ).toBeVisible();
    if (mode === 'loading') {
      await page
        .getByLabel('选择 CSV 文件')
        .setInputFiles(buildSyntheticCsvPayload());
      await expect(page.getByText('正在校验 CSV 文件…')).toBeVisible();
    } else if (mode === 'error') {
      await page
        .getByLabel('选择 CSV 文件')
        .setInputFiles(
          buildSyntheticCsvPayload(SENTINELS.csvPassword, { withErrors: true }),
        );
      await expect(
        page.getByText(/CSV 服务端校验未通过|错误/).first(),
      ).toBeVisible();
    } else if (mode === 'ready' && options.populateCsv) {
      await page
        .getByLabel('选择 CSV 文件')
        .setInputFiles(buildSyntheticCsvPayload());
      await expect(page.getByText('csv.alpha@gmail.com')).toBeVisible();
    } else {
      await expect(page.getByText(/暂无预览数据/)).toBeVisible();
    }
  }

  await waitForStableFontsAndPaint(page);
}

export function getDynamicScreenshotMasks(page: Page): Locator[] {
  return [
    page.locator('[data-dynamic="clock"]'),
    page.locator('[data-dynamic="timestamp"]'),
    page.locator('[data-dynamic="id"]'),
    page.locator('time'),
  ];
}

export async function assertNoOverflow(page: Page, contextLabel: string) {
  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docOverflow = document.documentElement.scrollWidth - vw;
    const bodyOverflow = document.body.scrollWidth - vw;

    const shell = document.querySelector('[data-slot="app-window-shell"]');
    const shellRect = shell?.getBoundingClientRect();
    const shellOverflow = shellRect
      ? {
          left: Math.round(shellRect.left),
          rightExcess: Math.round(shellRect.right - vw),
        }
      : null;

    const dialogIssues: string[] = [];
    document
      .querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
      .forEach((el) => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (
          r.left < -2 ||
          r.right > vw + 2 ||
          r.top < -2 ||
          r.bottom > vh + 2
        ) {
          dialogIssues.push(
            `${el.getAttribute('aria-label') || el.getAttribute('data-slot') || 'dialog'}: rect(${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}) vs viewport(${vw}x${vh})`,
          );
        }
      });

    return {
      vw,
      vh,
      docOverflow,
      bodyOverflow,
      shellOverflow,
      dialogIssues,
    };
  });

  expect(
    report.docOverflow,
    `${contextLabel}: documentElement horizontal overflow (${JSON.stringify(report)})`,
  ).toBeLessThanOrEqual(1);
  expect(
    report.bodyOverflow,
    `${contextLabel}: body horizontal overflow (${JSON.stringify(report)})`,
  ).toBeLessThanOrEqual(1);
  if (report.shellOverflow) {
    expect(
      report.shellOverflow.left,
      `${contextLabel}: app-window-shell clipped left`,
    ).toBeGreaterThanOrEqual(-1);
    expect(
      report.shellOverflow.rightExcess,
      `${contextLabel}: app-window-shell overflows right`,
    ).toBeLessThanOrEqual(1);
  }
  expect(
    report.dialogIssues,
    `${contextLabel}: open dialog overflows viewport`,
  ).toEqual([]);
}

export async function assertWcag22AA(
  page: Page,
  contextLabel: string,
  options: { checkTargetSize?: boolean; checkFocusNotObscured?: boolean } = {},
) {
  const axeResult = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const summary = axeResult.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => ({
      target: n.target,
      summary: n.failureSummary,
    })),
  }));

  expect(
    summary,
    `${contextLabel}: WCAG 2.2 AA axe-core violations\n${JSON.stringify(summary, null, 2)}`,
  ).toEqual([]);

  if (options.checkTargetSize !== false) {
    const smallTargets = await page.evaluate(() => {
      const selector =
        'button, a[href], input:not([type="hidden"]):not([type="file"]), select, textarea, [role="tab"], [role="switch"], [role="menuitem"], [role="slider"]';
      const issues: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const style = getComputedStyle(el);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.pointerEvents === 'none' ||
          el.getAttribute('aria-hidden') === 'true'
        ) {
          continue;
        }
        // Native checkboxes/radios or inline text links have WCAG 2.5.8 user-agent / inline exemptions;
        // still enforce strict 24x24px on all custom interactive buttons/switches/tabs/inputs.
        if (
          el.tagName === 'INPUT' &&
          ((el as HTMLInputElement).type === 'checkbox' ||
            (el as HTMLInputElement).type === 'radio' ||
            (el as HTMLInputElement).type === 'range')
        ) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width < 23.5 || rect.height < 23.5) {
          const label = (
            el.getAttribute('aria-label') ||
            el.textContent ||
            el.tagName
          )
            .trim()
            .slice(0, 40);
          issues.push(
            `${el.tagName}[${label}]: ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
          );
        }
      }
      return issues;
    });

    expect(
      smallTargets,
      `${contextLabel}: WCAG 2.2 SC 2.5.8 target size < 24x24px`,
    ).toEqual([]);
  }

  if (options.checkFocusNotObscured) {
    const focusCheck = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) {
        return { ok: true, reason: 'no active element' };
      }
      const rect = active.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { ok: false, reason: 'active element has zero size' };
      }
      const cx = Math.min(
        window.innerWidth - 1,
        Math.max(1, rect.left + rect.width / 2),
      );
      const cy = Math.min(
        window.innerHeight - 1,
        Math.max(1, rect.top + rect.height / 2),
      );
      const topEl = document.elementFromPoint(cx, cy);
      const visible =
        Boolean(topEl) &&
        (topEl === active ||
          active.contains(topEl) ||
          Boolean(topEl?.contains(active)));
      return {
        ok: visible,
        reason: visible
          ? 'visible'
          : `active=${active.tagName}(${active.getAttribute('aria-label') || active.textContent?.trim()}) covered by ${topEl?.tagName}.${topEl?.className}`,
      };
    });
    expect(
      focusCheck.ok,
      `${contextLabel}: WCAG 2.2 SC 2.4.11 focus obscured: ${focusCheck.reason}`,
    ).toBe(true);
  }
}

export async function assertFocusTrap(
  page: Page,
  dialog: Locator,
  contextLabel: string,
) {
  await expect(dialog, `${contextLabel}: dialog must be visible`).toBeVisible();

  const focusableCount = await dialog.evaluate((root) => {
    const sel =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        s.visibility !== 'hidden' &&
        s.display !== 'none'
      );
    }).length;
  });

  expect(
    focusableCount,
    `${contextLabel}: dialog should have focusable elements`,
  ).toBeGreaterThanOrEqual(2);

  const isFocusInside = () =>
    dialog.evaluate(
      (root) =>
        document.activeElement !== null &&
        root.contains(document.activeElement),
    );

  // Move focus inside if browser didn't auto-focus yet, then verify strict trap in both directions.
  if (!(await isFocusInside())) {
    await page.keyboard.press('Tab');
  }
  expect(
    await isFocusInside(),
    `${contextLabel}: initial focus must reside inside dialog`,
  ).toBe(true);

  const steps = Math.min(Math.max(focusableCount + 3, 6), 24);
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Tab');
    expect(
      await isFocusInside(),
      `${contextLabel}: Tab #${i + 1} escaped dialog focus trap`,
    ).toBe(true);
  }

  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(
      await isFocusInside(),
      `${contextLabel}: Shift+Tab #${i + 1} escaped dialog focus trap`,
    ).toBe(true);
  }
}

export async function assertNoSensitiveLeak(
  page: Page,
  secrets: readonly string[],
  contextLabel: string,
) {
  const snapshot = await page.evaluate(async () => {
    const inputValues = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input, textarea',
      ),
    )
      .map((el) => el.value)
      .join('\n');

    const localEntries = JSON.stringify(window.localStorage);
    const sessionEntries = JSON.stringify(window.sessionStorage);
    const cookies = document.cookie;

    let idbNames = '';
    if ('indexedDB' in window && typeof indexedDB.databases === 'function') {
      try {
        const dbs = await indexedDB.databases();
        idbNames = JSON.stringify(dbs);
      } catch {
        idbNames = '';
      }
    }

    let cacheKeys = '';
    if ('caches' in window && typeof caches.keys === 'function') {
      try {
        cacheKeys = JSON.stringify(await caches.keys());
      } catch {
        cacheKeys = '';
      }
    }

    return {
      bodyText: document.body.innerText,
      inputValues,
      localEntries,
      sessionEntries,
      cookies,
      idbNames,
      cacheKeys,
    };
  });

  for (const secret of secrets) {
    expect(
      snapshot.bodyText,
      `${contextLabel}: secret leaked into rendered DOM`,
    ).not.toContain(secret);
    expect(
      snapshot.inputValues,
      `${contextLabel}: secret leaked into input value`,
    ).not.toContain(secret);
    expect(
      snapshot.localEntries,
      `${contextLabel}: secret leaked into localStorage`,
    ).not.toContain(secret);
    expect(
      snapshot.sessionEntries,
      `${contextLabel}: secret leaked into sessionStorage`,
    ).not.toContain(secret);
    expect(
      snapshot.cookies,
      `${contextLabel}: secret leaked into document.cookie`,
    ).not.toContain(secret);
    expect(
      snapshot.idbNames,
      `${contextLabel}: secret leaked into IndexedDB metadata`,
    ).not.toContain(secret);
    expect(
      snapshot.cacheKeys,
      `${contextLabel}: secret leaked into Cache Storage`,
    ).not.toContain(secret);
  }
}
