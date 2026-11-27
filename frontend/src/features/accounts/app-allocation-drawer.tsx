import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, KeyRound, Loader2, Search } from 'lucide-react';
import {
  accountsAssignApp,
  accountsList,
  type AccountSummary,
  type ErrorResponse,
  type RegisteredAppUsage,
  type SessionResponse,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AppBrandIcon } from './app-brand-icon';
import { factorLabels } from './constants';
import { PasswordControl } from './password-control';

export function AppAllocationDrawer({
  app,
  open,
  session,
  onSession,
  onFailure,
  onOpenChange,
}: {
  app: RegisteredAppUsage | null;
  open: boolean;
  session: SessionResponse;
  onSession: (next: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onOpenChange: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [only2Fa, setOnly2Fa] = useState(false);
  const [expandedSecretId, setExpandedSecretId] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const availableQuery = useQuery({
    queryKey: ['app-allocation-candidates', app?.id, search, only2Fa],
    enabled: Boolean(open && app?.id),
    queryFn: async ({ signal }) =>
      (
        await accountsList({
          query: {
            status: 'normal',
            archived: false,
            exclude_app_id: app!.id,
            two_factor_status: only2Fa ? 'enabled' : undefined,
            search: search.trim() || undefined,
            page: 1,
            page_size: 20,
          },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const handleAssign = async (candidate: AccountSummary) => {
    if (!app || assigningId) return;
    setAssigningId(candidate.id);
    setFeedback('');
    try {
      await accountsAssignApp({
        path: { account_id: candidate.id },
        body: {
          row_version: candidate.row_version,
          app_id: app.id,
          status: 'active',
          note: notesById[candidate.id]?.trim() || null,
        },
        headers: { 'X-CSRF-Token': session.csrf_token },
        throwOnError: true,
      });
      setExpandedSecretId((cur) => (cur === candidate.id ? null : cur));
      setFeedback(`已为 ${candidate.gmail_email} 登记注册「${app.name}」。`);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['app-allocation-candidates'],
        }),
        queryClient.invalidateQueries({ queryKey: ['apps-usage'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      ]);
    } catch (error) {
      const msg = (error as Partial<ErrorResponse>)?.error?.message;
      setFeedback(msg || '登记应用失败，请刷新后重试。');
      onFailure(error);
    } finally {
      setAssigningId(null);
    }
  };

  const candidates = availableQuery.data?.items ?? [];

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setExpandedSecretId(null);
          setFeedback('');
        }
        onOpenChange(next);
      }}
    >
      <SheetContent
        data-slot="app-allocation-drawer"
        className="macos-glass-modal flex w-full flex-col overflow-hidden border-l border-white/80 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 border-b border-[var(--table-divider)] px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            {app && (
              <AppBrandIcon
                name={app.name}
                domain={app.domain}
                iconData={app.icon_data}
                size="md"
              />
            )}
            <div>
              <SheetTitle>快速领号：{app?.name ?? '应用'}</SheetTitle>
              <SheetDescription>
                自动筛选尚未注册「{app?.name}」的正常 Gmail
                账号，支持查密并一键登记已注册
              </SheetDescription>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative flex min-w-0 flex-1 items-center">
              <Search
                className="pointer-events-none absolute left-3 size-3.5 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="搜索可用候选账号"
                placeholder="搜索编号、邮箱或用途…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8.5 pl-8.5 text-xs"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2.5 py-1.5 text-xs">
              <input
                type="checkbox"
                checked={only2Fa}
                onChange={(e) => setOnly2Fa(e.target.checked)}
                className="size-3.5 rounded accent-[var(--accent)]"
              />
              <span>仅已启用 2FA</span>
            </label>
          </div>
        </SheetHeader>

        <div className="macos-thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {feedback && (
            <p
              role="status"
              className="rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-xs font-medium text-[var(--badge-green-text)]"
            >
              {feedback}
            </p>
          )}

          {availableQuery.isPending ? (
            <p role="status" className="text-xs text-[var(--text-secondary)]">
              正在检索可用干净账号…
            </p>
          ) : candidates.length === 0 ? (
            <p className="py-8 text-center text-xs text-[var(--text-secondary)]">
              当前没有满足条件的未注册正常账号。
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--text-secondary)]">
                共找到 {availableQuery.data?.total ?? candidates.length}{' '}
                个可用正常账号（展示前 {candidates.length} 条）
              </p>
              <ul className="space-y-3">
                {candidates.map((item) => {
                  const secretOpen = expandedSecretId === item.id;
                  const isBusy = assigningId === item.id;
                  return (
                    <li
                      key={item.id}
                      className="space-y-2.5 rounded-2xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-3.5 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
                            {item.gmail_email}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                            {item.account_no} · 2FA：
                            {factorLabels[item.two_factor_status]}
                            {item.purpose ? ` · ${item.purpose}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void navigator.clipboard
                                ?.writeText(item.gmail_email)
                                .then(() =>
                                  setFeedback(`已复制邮箱 ${item.gmail_email}`),
                                )
                                .catch(() => {})
                            }
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                            复制邮箱
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={secretOpen ? 'secondary' : 'outline'}
                            onClick={() =>
                              setExpandedSecretId(secretOpen ? null : item.id)
                            }
                          >
                            <KeyRound className="size-3.5" aria-hidden="true" />
                            {secretOpen ? '收起密码' : '查密'}
                          </Button>
                        </div>
                      </div>

                      {secretOpen && (
                        <PasswordControl
                          key={`alloc-pwd-${item.id}`}
                          accountId={item.id}
                          session={session}
                          onSession={onSession}
                          onFailure={onFailure}
                        />
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Input
                          aria-label={`${item.gmail_email} 注册备注`}
                          placeholder="可选：填写非敏感业务用途或套餐说明…"
                          maxLength={200}
                          value={notesById[item.id] ?? ''}
                          onChange={(e) =>
                            setNotesById((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          className="h-8 min-w-0 flex-1 text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          disabled={Boolean(assigningId)}
                          onClick={() => void handleAssign(item)}
                        >
                          {isBusy ? (
                            <Loader2
                              className="size-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCircle2
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          )}
                          <span>登记已注册</span>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
