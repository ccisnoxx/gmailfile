import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import {
  backupStatus,
  settingsGet,
  settingsIdle,
  systemVersion,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { localDate } from '@/lib/format';
import { failureText, type OperationsPanelProps } from './shared';

const backupLabels = {
  unconfigured: '未配置',
  never_run: '尚未运行',
  running: '正在备份',
  success: '成功',
  failed: '失败，需处理',
  stale: '已过期，需处理',
};

const offsiteLabels = {
  unconfigured: '未配置',
  pending: '等待完成',
  success: '成功',
  failed: '失败',
};

export function StatusPanel(props: OperationsPanelProps) {
  const query = useQuery({
    queryKey: ['operations-status'],
    queryFn: async ({ signal }) => {
      const [v, b, s] = await Promise.all([
        systemVersion({ signal, throwOnError: true }),
        backupStatus({ signal, throwOnError: true }),
        settingsGet({ signal, throwOnError: true }),
      ]);
      return { version: v.data, backup: b.data, settings: s.data };
    },
  });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (query.error) props.onFailure(query.error);
  }, [query.error, props.onFailure]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">运行与设置</h2>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw />
          刷新
        </Button>
      </div>
      {query.error ? (
        <p role="alert">{failureText(query.error)}</p>
      ) : !query.data ? (
        <p>正在读取…</p>
      ) : (
        <>
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">
                应用 / 数据库版本
              </dt>
              <dd className="mt-2 font-medium">
                {query.data.version.version} /{' '}
                {query.data.version.schema_version}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">最近备份状态</dt>
              <dd className="mt-2 font-medium">
                {backupLabels[query.data.backup.state]}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">最近本地成功</dt>
              <dd className="mt-2">
                {localDate(query.data.backup.last_success_at)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">异地传输</dt>
              <dd className="mt-2">
                {offsiteLabels[query.data.backup.offsite ?? 'unconfigured']}
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            每日任务超过 36
            小时无新成功记为过期。成功状态不代替恢复演练或生产验收。
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const minutes = Number(
                new FormData(e.currentTarget).get('minutes'),
              );
              setBusy(true);
              setNotice('');
              try {
                await settingsIdle({
                  body: { idle_minutes: minutes },
                  headers: { 'X-CSRF-Token': props.session.csrf_token },
                  throwOnError: true,
                });
                if (active.current) props.onRefreshSession();
              } catch (error) {
                if (active.current) {
                  setNotice(failureText(error, true));
                  props.onFailure(error);
                }
              } finally {
                if (active.current) setBusy(false);
              }
            }}
            className="max-w-xl space-y-3 border-t pt-6"
          >
            <label htmlFor="idle-minutes" className="font-medium">
              自动锁定时间（分钟）
            </label>
            <div className="flex gap-3">
              <Input
                id="idle-minutes"
                name="minutes"
                type="number"
                min={1}
                max={720}
                defaultValue={query.data.settings.idle_minutes}
                required
              />
              <Button disabled={busy}>保存</Button>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              需最近重新验证。立即应用于所有会话，按各自最近活动计算，不重置活动时间或绝对期限；缩短后可能立即退出当前会话。
            </p>
          </form>
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
    </div>
  );
}
