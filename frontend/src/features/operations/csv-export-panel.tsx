import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { csvExport } from '@/api/generated';
import type { AccountQuery } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { accountQuery } from '@/features/accounts/query-state';
import { failureText, type OperationsPanelProps } from './shared';

export function ExportPanel(props: OperationsPanelProps) {
  const [scope, setScope] = useState<'all' | 'filtered'>('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const filters = accountQuery(new URLSearchParams(window.location.search));

  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-lg font-semibold">非敏感 CSV 导出</h2>
      <p className="text-sm leading-7 text-muted-foreground">
        导出编号、邮箱、注册/活动时间、辅助邮箱、状态、用途和标签；不包含密码、手机号、备注、TOTP、恢复码或
        Session 数据。UTF-8 BOM 可供 Excel 打开，公式前缀会加单引号。
      </p>
      <label className="block space-y-2">
        <span>导出范围</span>
        <NativeSelect
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="all">全部未删除账号（含归档）</option>
          <option value="filtered">
            账号列表当前筛选的全部结果（非当前页）
          </option>
        </NativeSelect>
      </label>
      {scope === 'filtered' && (
        <p className="break-all rounded-lg bg-muted p-3 text-sm">
          筛选：{window.location.search || '默认未删除，含归档'}
          。日期与列表相同，导出忽略页码和每页条数。
        </p>
      )}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const result = await csvExport({
              body:
                scope === 'all'
                  ? { scope }
                  : { scope, filters: filters as AccountQuery },
              headers: { 'X-CSRF-Token': props.session.csrf_token },
              parseAs: 'blob',
              throwOnError: true,
            });
            if (!alive.current || document.hidden) return;
            const url = URL.createObjectURL(result.data);
            const a = document.createElement('a');
            a.href = url;
            a.download =
              /filename="([^"]+)"/.exec(
                result.response.headers.get('Content-Disposition') || '',
              )?.[1] || 'gmail-accounts.csv';
            a.click();
            URL.revokeObjectURL(url);
            setMessage('导出文件已交给浏览器下载。');
          } catch (error) {
            if (alive.current) {
              setMessage(failureText(error));
              props.onFailure(error);
            }
          } finally {
            if (alive.current) setBusy(false);
          }
        }}
      >
        <Download />
        {busy ? '正在准备…' : '下载非敏感 CSV'}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
