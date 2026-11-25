import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { healthLive } from '@/api/generated/sdk.gen';
import { Button } from '@/components/ui/button';

export function OverviewPage() {
  const health = useQuery({
    queryKey: ['health', 'live'],
    queryFn: async () => {
      const result = await healthLive({ throwOnError: true });
      return result.data;
    },
    enabled: false,
  });

  let connection = '尚未检查';
  if (health.isFetching) connection = '正在连接…';
  else if (health.isError) connection = '无法连接 API，请检查后端服务';
  else if (health.isSuccess) connection = 'API 已连接';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 sm:px-10">
          <div className="flex items-center gap-3 font-semibold">
            <Mail className="size-5 text-primary" aria-hidden="true" />
            <span>Gmail 账号管理</span>
          </div>
          <span className="text-sm text-muted-foreground">
            工程骨架 · v0.1.0
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-14 sm:px-10 sm:py-20">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            从安全的基础开始。
          </h1>
          <p className="mt-5 text-base leading-8 text-muted-foreground">
            当前为阶段 0
            的工程概览。认证与加密将在下一阶段完成，账号资料功能尚未开放。
          </p>
        </div>

        <section
          aria-labelledby="connection-title"
          className="mt-12 border-y py-8"
        >
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div className="flex flex-col gap-2">
              <h2 id="connection-title" className="text-lg font-semibold">
                服务连接
              </h2>
              <p
                role="status"
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                {connection}
              </p>
            </div>
            <Button
              onClick={() => void health.refetch()}
              disabled={health.isFetching}
            >
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              检查 API 连接
            </Button>
          </div>
        </section>

        <section
          aria-labelledby="next-title"
          className="mt-10 flex max-w-2xl gap-4"
        >
          <ShieldCheck
            className="mt-1 size-6 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <h2 id="next-title" className="font-semibold">
              下一步：认证和安全基础
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              管理员初始化、TOTP、服务端会话、CSRF 与 AES-256-GCM
              加密通过验证后，再开始账号管理。
            </p>
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowRight className="size-4" aria-hidden="true" />
              此页面只检查 API 存活，不代表数据库或生产部署已通过验收。
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
