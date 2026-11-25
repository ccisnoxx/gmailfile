import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OperationsPanelProps } from './shared';
import { StatusPanel } from './status-panel';

const ImportPanel = lazy(() =>
  import('./csv-import-panel').then((m) => ({ default: m.ImportPanel })),
);
const ExportPanel = lazy(() =>
  import('./csv-export-panel').then((m) => ({ default: m.ExportPanel })),
);
const SessionsPanel = lazy(() =>
  import('./sessions-panel').then((m) => ({ default: m.SessionsPanel })),
);
const AuditPanel = lazy(() =>
  import('./audit-panel').then((m) => ({ default: m.AuditPanel })),
);

type OperationsTab = 'status' | 'import' | 'export' | 'sessions' | 'audit';

const tabItems: readonly [OperationsTab, string][] = [
  ['status', '运行与设置'],
  ['import', 'CSV 导入'],
  ['export', 'CSV 导出'],
  ['sessions', 'Session 管理'],
  ['audit', '审计日志'],
];

export function OperationsPage(props: OperationsPanelProps) {
  const [tab, setTab] = useState<OperationsTab>('status');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3 font-semibold">
            <Mail className="size-5 text-primary" />
            Gmail 账号管理
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={props.onSecurity}>
              安全设置
            </Button>
            <Button variant="outline" onClick={props.onBack}>
              <ArrowLeft />
              账号列表
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-7 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold">迁移与运维</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            导入资料、管理会话，查看真实运行记录。数据库恢复仅通过服务器 CLI。
          </p>
        </div>
        <nav aria-label="迁移与运维" className="flex flex-wrap gap-2">
          {tabItems.map(([id, label]) => (
            <Button
              key={id}
              variant={tab === id ? 'secondary' : 'ghost'}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <section key={tab} className="rounded-xl border bg-card p-5 sm:p-7">
          <Suspense fallback={<p role="status">正在加载模块…</p>}>
            {tab === 'status' ? (
              <StatusPanel {...props} />
            ) : tab === 'import' ? (
              <ImportPanel {...props} />
            ) : tab === 'export' ? (
              <ExportPanel {...props} />
            ) : tab === 'sessions' ? (
              <SessionsPanel {...props} />
            ) : (
              <AuditPanel {...props} />
            )}
          </Suspense>
        </section>
      </main>
    </div>
  );
}
