import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  sessionsRevoke,
  sessionsRevokeOthers,
  settingsIdle,
  type SessionItem,
} from '@/api/generated';
import {
  formatSettingsDateTime,
  RESTORE_VERIFICATION_CHECKLIST,
} from './mock-fixtures';
import {
  forwardFatalSessionError,
  type PrependMockAuditFn,
} from './settings-data-helpers';
import type {
  ActiveSessionRow,
  BackupArchiveItem,
  BackupRestoreInfo,
  RestoreCheckItem,
  RestoreVerifyReport,
  RetentionPolicyInfo,
  SensitiveVerifyPayload,
  SettingsActionResult,
  SystemRuntimeInfo,
} from './types';

export type UseSettingsOpsActionsOptions = {
  isLive: boolean;
  onFailure?: (error: unknown) => void;
  onRefreshSession?: () => void;
  onSignedOut?: (revocation: Promise<unknown>) => void;
  simulateActionFailure: boolean;
  queryClient: QueryClient;
  busyRef: MutableRefObject<boolean>;
  headersWithCsrf: (
    csrfOverride?: string,
  ) => { 'X-CSRF-Token': string } | undefined;
  ensureReverifiedIfNeeded: (
    verify?: SensitiveVerifyPayload,
  ) => Promise<SettingsActionResult & { csrfToken?: string }>;
  sessionsItems?: SessionItem[];
  serverIdleMinutes?: number;
  mockSessions: ActiveSessionRow[];
  setMockSessions: Dispatch<SetStateAction<ActiveSessionRow[]>>;
  setMockBackup: Dispatch<SetStateAction<BackupRestoreInfo>>;
  setMockRetention: Dispatch<SetStateAction<RetentionPolicyInfo>>;
  setMockRuntime: Dispatch<SetStateAction<SystemRuntimeInfo>>;
  backupRunning: boolean;
  setBackupRunning: Dispatch<SetStateAction<boolean>>;
  prependMockAudit: PrependMockAuditFn;
};

export function useSettingsOpsActions({
  isLive,
  onFailure,
  onRefreshSession,
  onSignedOut,
  simulateActionFailure,
  queryClient,
  busyRef,
  headersWithCsrf,
  ensureReverifiedIfNeeded,
  sessionsItems,
  serverIdleMinutes,
  mockSessions,
  setMockSessions,
  setMockBackup,
  setMockRetention,
  setMockRuntime,
  backupRunning,
  setBackupRunning,
  prependMockAudit,
}: UseSettingsOpsActionsOptions) {
  const terminateSession = useCallback(
    async (
      sessionId: string,
      verify?: SensitiveVerifyPayload,
    ): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在执行其他会话操作，请稍候。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '终止会话失败：服务拒绝请求（未自动重试）。',
        };
      }
      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded(verify);
        if (!reauth.ok) return reauth;

        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        if (isLive && nextHeaders) {
          const isCurrent = sessionsItems?.some(
            (s) => s.id === sessionId && s.current,
          );
          if (isCurrent && onSignedOut) {
            onSignedOut(
              sessionsRevoke({
                path: { session_id: sessionId },
                headers: nextHeaders,
                throwOnError: true,
              }),
            );
            return { ok: true, message: '当前会话已终止。' };
          }
          await sessionsRevoke({
            path: { session_id: sessionId },
            headers: nextHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-sessions'],
          });
          return { ok: true, message: '目标会话已终止。' };
        }

        const target = mockSessions.find((s) => s.id === sessionId);
        setMockSessions((prev) => prev.filter((s) => s.id !== sessionId));
        prependMockAudit(
          'session_revoked',
          '终止会话',
          'session',
          target ? `${target.deviceBrowser} (${target.ipAddress})` : sessionId,
        );
        return {
          ok: true,
          message: target
            ? `已终止会话：${target.deviceBrowser}`
            : '目标会话已终止。',
        };
      } catch (error) {
        const info = forwardFatalSessionError(error, onFailure);
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      busyRef,
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      mockSessions,
      onFailure,
      onSignedOut,
      prependMockAudit,
      queryClient,
      sessionsItems,
      setMockSessions,
      simulateActionFailure,
    ],
  );

  const logoutOtherSessions = useCallback(
    async (verify?: SensitiveVerifyPayload): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在执行其他会话操作，请稍候。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '退出其他会话失败：无法确认远端撤销状态（未自动重试）。',
        };
      }
      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded(verify);
        if (!reauth.ok) return reauth;

        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        if (isLive && nextHeaders) {
          await sessionsRevokeOthers({
            headers: nextHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-sessions'],
          });
          return { ok: true, message: '已退出所有其他设备会话。' };
        }

        setMockSessions((prev) => prev.filter((s) => s.current));
        prependMockAudit(
          'sessions_revoked_others',
          '退出其他会话',
          'session',
          '全部非当前活动会话',
        );
        return { ok: true, message: '已退出所有其他活动会话。' };
      } catch (error) {
        const info = forwardFatalSessionError(error, onFailure);
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      busyRef,
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      prependMockAudit,
      queryClient,
      setMockSessions,
      simulateActionFailure,
    ],
  );

  const runImmediateBackup =
    useCallback(async (): Promise<SettingsActionResult> => {
      if (isLive) {
        return {
          ok: false,
          error:
            '在线 Web 控制台不支持直接触发服务器备份，请通过部署主机备份脚本或定时任务执行 pg_dump + age 加密备份。',
        };
      }
      if (backupRunning) {
        return { ok: false, error: '已有备份任务正在执行，请等待完成。' };
      }
      setBackupRunning(true);
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        if (simulateActionFailure) {
          setMockBackup((prev) => ({
            ...prev,
            state: 'failed',
            statusLabel: '备份失败',
          }));
          prependMockAudit(
            'backup_failed',
            '手动备份',
            'backup',
            'pg_dump + age 归档',
            'failed',
          );
          return {
            ok: false,
            error:
              '备份执行失败：age 加密归档校验未通过，请排查磁盘与密钥配置后手动重试。',
          };
        }

        const now = new Date();
        const formatted = formatSettingsDateTime(now.toISOString(), true);
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const suffix = Math.random().toString(36).slice(2, 6);
        const newArchive: BackupArchiveItem = {
          id: `bkp-${stamp}-${suffix}`,
          filename: `gmailfile_${stamp}.pgdump.age`,
          createdAt: formatted,
          sizeLabel: '64.5 MB',
          method: 'pg_dump + age 加密',
          checksumShort: 'sha256:c18b…4e20',
        };

        setMockBackup((prev) => ({
          ...prev,
          state: 'success',
          statusLabel: '备份正常',
          lastBackupAt: formatted,
          archives: [newArchive, ...prev.archives],
        }));
        prependMockAudit(
          'backup_completed',
          '立即备份',
          'backup',
          newArchive.filename,
        );

        return {
          ok: true,
          message: `加密备份已完成（${newArchive.filename}）`,
        };
      } finally {
        setBackupRunning(false);
      }
    }, [
      backupRunning,
      isLive,
      prependMockAudit,
      setBackupRunning,
      setMockBackup,
      simulateActionFailure,
    ]);

  const runRestoreVerification = useCallback(
    async (archive: BackupArchiveItem): Promise<RestoreVerifyReport> => {
      const verifiedAt = formatSettingsDateTime(new Date().toISOString());
      if (isLive) {
        return {
          archive,
          passed: false,
          verifiedAt,
          durationMs: 0,
          sampledRows: 0,
          checks: RESTORE_VERIFICATION_CHECKLIST.map((item) => ({
            ...item,
            status: 'pending',
            detail: '需通过部署主机离线恢复脚本执行',
          })),
          errorMessage:
            '在线 Web 控制台不支持直接执行沙箱恢复演练，请通过部署主机离线恢复脚本验证归档完整性。',
        };
      }

      const started = performance.now();
      await new Promise((resolve) => window.setTimeout(resolve, 360));

      if (simulateActionFailure) {
        const failedChecks: RestoreCheckItem[] =
          RESTORE_VERIFICATION_CHECKLIST.map((item, idx) => ({
            ...item,
            status: idx < 2 ? 'passed' : idx === 2 ? 'failed' : 'pending',
            detail:
              idx < 2
                ? '校验通过'
                : idx === 2
                  ? '外键约束检查检测到缺失标签引用，已中止验证'
                  : '因前置步骤失败未执行',
          }));
        return {
          archive,
          passed: false,
          verifiedAt,
          durationMs: Math.max(380, Math.round(performance.now() - started)),
          sampledRows: 0,
          checks: failedChecks,
          errorMessage:
            '恢复验证未通过：检测到约束校验失败，请勿将该归档作为最新恢复基线。',
        };
      }

      const passedChecks: RestoreCheckItem[] =
        RESTORE_VERIFICATION_CHECKLIST.map((item) => ({
          ...item,
          status: 'passed',
          detail:
            item.id === 'age-decrypt'
              ? `校验和 ${archive.checksumShort} 匹配`
              : item.id === 'schema-structure'
                ? '14 张核心表与迁移版本 0004 一致'
                : item.id === 'constraints'
                  ? '唯一索引与外键完整性 100% 通过'
                  : '抽样 24 条加密记录完成内存认证解密',
        }));

      setMockBackup((prev) => ({
        ...prev,
        lastRestoreVerifiedAt: verifiedAt,
        restoreVerifySummary: '结构、约束与抽样解密',
      }));
      prependMockAudit(
        'restore_verified',
        '恢复验证',
        'backup',
        archive.filename,
      );

      return {
        archive,
        passed: true,
        verifiedAt,
        durationMs: Math.max(410, Math.round(performance.now() - started)),
        sampledRows: 24,
        checks: passedChecks,
      };
    },
    [isLive, prependMockAudit, setMockBackup, simulateActionFailure],
  );

  const updateRetentionPolicy = useCallback(
    async (
      next: {
        auditRetentionDays: number;
        backupRetentionDays: number;
        idleMinutes?: number;
      },
      verify?: SensitiveVerifyPayload,
    ): Promise<SettingsActionResult> => {
      if (
        !isLive &&
        (next.auditRetentionDays < 30 ||
          next.auditRetentionDays > 3650 ||
          next.backupRetentionDays < 7 ||
          next.backupRetentionDays > 1095)
      ) {
        return {
          ok: false,
          error:
            '保留天数超出允许范围（审计日志 30–3650 天，备份 7–1095 天）。',
        };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '保存生命周期策略失败：服务端配置写入被拒绝（未自动重试）。',
        };
      }

      if (
        isLive &&
        (typeof next.idleMinutes !== 'number' ||
          next.idleMinutes === serverIdleMinutes)
      ) {
        return {
          ok: false,
          error:
            '当前服务端仅支持在线修改会话空闲自动锁定时间；审计与备份保留天数请通过部署环境变量调整。',
        };
      }

      const reauth = await ensureReverifiedIfNeeded(verify);
      if (!reauth.ok) return reauth;

      const nextHeaders = headersWithCsrf(reauth.csrfToken);
      if (isLive && nextHeaders) {
        try {
          await settingsIdle({
            body: { idle_minutes: next.idleMinutes! },
            headers: nextHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-system-meta'],
          });
          onRefreshSession?.();
          return { ok: true, message: '会话空闲自动锁定策略已更新。' };
        } catch (error) {
          const info = forwardFatalSessionError(error, onFailure);
          return {
            ok: false,
            error: info.message,
            requireReauth: info.code === 'REAUTH_REQUIRED',
          };
        }
      }

      setMockRetention((prev) => ({
        ...prev,
        auditRetentionDays: next.auditRetentionDays,
        backupRetentionDays: next.backupRetentionDays,
      }));
      if (typeof next.idleMinutes === 'number') {
        setMockRuntime((prev) => ({
          ...prev,
          idleMinutes: next.idleMinutes!,
        }));
      }
      prependMockAudit(
        'settings_updated',
        '调整生命周期策略',
        'settings',
        `审计 ${next.auditRetentionDays} 天 / 备份 ${next.backupRetentionDays} 天`,
      );
      return { ok: true, message: '日志保留与数据生命周期策略已保存。' };
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      onRefreshSession,
      prependMockAudit,
      queryClient,
      serverIdleMinutes,
      setMockRetention,
      setMockRuntime,
      simulateActionFailure,
    ],
  );

  return {
    terminateSession,
    logoutOtherSessions,
    runImmediateBackup,
    runRestoreVerification,
    updateRetentionPolicy,
  };
}
