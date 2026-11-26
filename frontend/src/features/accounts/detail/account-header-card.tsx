import { useEffect, useRef, useState } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import {
  Archive,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import type { AccountDetail, TagResponse } from '@/api/generated';
import { GlassPanel, GmailMark, StatusPill, TagPill } from '@/components/macos';
import { cn } from '@/lib/utils';
import { formatDetailDateTime } from './detail-mock-fixtures';

export function AccountHeaderCard({
  account,
  availableTags,
  isEditing,
  busy = false,
  onCopyEmail,
  onEdit,
  onArchive,
  onUnarchive,
  onDelete,
  onRestore,
  onViewAudit,
  onMarkLoggedIn,
  onMarkVerified,
  onAddTag,
  onCreateAndAttachTag,
}: {
  account: AccountDetail;
  availableTags: TagResponse[];
  isEditing: boolean;
  busy?: boolean;
  onCopyEmail: (email: string) => void;
  onEdit: () => void;
  onArchive: () => void;
  onUnarchive?: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onViewAudit: () => void;
  onMarkLoggedIn?: () => void;
  onMarkVerified?: () => void;
  onAddTag?: (tag: TagResponse) => void;
  onCreateAndAttachTag?: (tagName: string) => void;
}) {
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const addTagBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!tagMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        tagPickerRef.current &&
        !tagPickerRef.current.contains(event.target as Node)
      ) {
        setTagMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setTagMenuOpen(false);
        addTagBtnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [tagMenuOpen]);

  const attachedTagIds = new Set(account.tags.map((t) => t.id));
  const unattachedTags = availableTags.filter((t) => !attachedTagIds.has(t.id));
  const menuItemClass =
    'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] outline-none transition-colors data-[highlighted]:bg-[var(--accent-soft)] focus:bg-[var(--accent-soft)]';

  const canRestore = Boolean(account.deleted_at);
  const canUnarchive = !account.deleted_at && account.status === 'archived';

  return (
    <GlassPanel
      variant="strong"
      data-slot="account-header-card"
      className="relative z-20 rounded-[20px] p-[var(--detail-pad,20px)]"
    >
      {/* 上半部分：Gmail 大图标 + 邮箱 / 状态 / 元信息 */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="inline-flex size-16 shrink-0 items-center justify-center rounded-[18px] border border-white/90 bg-white/85 shadow-[0_8px_22px_rgba(45,86,138,0.09),inset_0_1px_0_rgba(255,255,255,0.95)]">
          <GmailMark size="lg" />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] leading-tight font-bold tracking-tight text-[var(--text-primary)]">
              {account.gmail_email}
            </h1>
            <button
              type="button"
              aria-label="复制邮箱"
              title="复制邮箱"
              onClick={() => onCopyEmail(account.gmail_email)}
              className="inline-flex size-7 items-center justify-center rounded-lg border border-transparent text-[var(--text-secondary)] transition-colors hover:border-white/80 hover:bg-white/75 hover:text-[var(--accent)]"
            >
              <Copy className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={account.status} />
            {account.deleted_at && (
              <span className="inline-flex items-center rounded-full border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--danger)]">
                已在回收站
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--text-secondary)]">
            <span>用途：{account.purpose || '未填写'}</span>
            <span aria-hidden="true" className="text-[#b8cbe2]">
              |
            </span>
            <span data-dynamic="timestamp" className="tabular-nums">
              创建时间：{formatDetailDateTime(account.created_at, false)}
            </span>
            <span aria-hidden="true" className="text-[#b8cbe2]">
              |
            </span>
            <span data-dynamic="timestamp" className="tabular-nums">
              最后更新：{formatDetailDateTime(account.updated_at, false)}
            </span>
          </div>
        </div>
      </div>

      {/* 下半部分：标签区 + 右侧玻璃操作按钮 */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--table-divider)] pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <TagIcon className="size-3.5" aria-hidden="true" />
            <span>标签：</span>
          </span>

          {account.tags.length > 0 ? (
            account.tags.map((tag) => (
              <TagPill
                key={tag.id}
                name={tag.name}
                className="rounded-lg px-2.5 py-1 text-xs"
              />
            ))
          ) : (
            <span className="text-xs text-[var(--text-secondary)]">
              暂无标签
            </span>
          )}

          {/* 添加标签按钮与弹出选择器 */}
          <div ref={tagPickerRef} className="relative">
            <button
              ref={addTagBtnRef}
              type="button"
              disabled={busy || Boolean(account.deleted_at)}
              aria-expanded={tagMenuOpen}
              onClick={() => setTagMenuOpen((open) => !open)}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/80 bg-white/58 px-2.5 text-xs font-medium text-[var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-colors hover:bg-white/85 hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>添加标签</span>
            </button>

            {tagMenuOpen && (
              <div
                role="dialog"
                aria-label="为账号添加标签"
                className="macos-glass-modal absolute top-full left-0 z-40 mt-2 w-64 rounded-2xl p-3 text-xs text-[var(--text-primary)]"
              >
                <p className="mb-2 font-semibold text-[var(--text-primary)]">
                  选择或新建标签
                </p>
                {unattachedTags.length > 0 && (
                  <div className="mb-2.5 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                    {unattachedTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          onAddTag?.(tag);
                          setTagMenuOpen(false);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/80 bg-white/75 px-2 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[#1677ff]/30 hover:bg-[#eaf3ff] hover:text-[var(--accent)]"
                      >
                        <Plus className="size-3" aria-hidden="true" />
                        <span>{tag.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {onCreateAndAttachTag && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      aria-label="新标签名称"
                      placeholder="输入新标签名称…"
                      value={newTagInput}
                      maxLength={50}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          const trimmed = newTagInput.trim();
                          if (trimmed) {
                            onCreateAndAttachTag(trimmed);
                            setNewTagInput('');
                            setTagMenuOpen(false);
                          }
                        }
                      }}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white/85 px-2.5 text-xs outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      aria-label="确认添加标签"
                      disabled={!newTagInput.trim()}
                      onClick={() => {
                        const trimmed = newTagInput.trim();
                        if (!trimmed) return;
                        onCreateAndAttachTag(trimmed);
                        setNewTagInput('');
                        setTagMenuOpen(false);
                      }}
                      className="inline-flex h-8 items-center justify-center rounded-lg bg-[var(--accent)] px-2.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧半透明玻璃操作按钮（仅“编辑”使用稍明显的蓝色） */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || Boolean(account.deleted_at)}
            aria-pressed={isEditing}
            onClick={onEdit}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium backdrop-blur-md transition-all duration-[180ms] ease-out disabled:opacity-50',
              isEditing
                ? 'border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]'
                : 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-text)] shadow-[0_4px_12px_rgba(22,119,255,0.1)] hover:-translate-y-[1px]',
            )}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            <span>{isEditing ? '编辑中' : '编辑'}</span>
          </button>

          {canUnarchive && onUnarchive ? (
            <button
              type="button"
              disabled={busy}
              onClick={onUnarchive}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/82 bg-white/62 px-3.5 text-[13px] font-medium text-[var(--accent-text)] shadow-[0_4px_12px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.88)] backdrop-blur-md transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/85 disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              <span>取消归档</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={
                busy ||
                Boolean(account.deleted_at) ||
                account.status === 'archived'
              }
              onClick={onArchive}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/82 bg-white/62 px-3.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_4px_12px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.88)] backdrop-blur-md transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/85 disabled:opacity-50"
            >
              <Archive
                className="size-3.5 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>归档</span>
            </button>
          )}

          <DropdownMenuPrimitive.Root
            onOpenChange={(open) => {
              if (open) setTagMenuOpen(false);
            }}
          >
            <DropdownMenuPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label="更多"
                title="更多操作"
                disabled={busy}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-white/82 bg-white/62 text-[var(--text-primary)] shadow-[0_4px_12px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.88)] backdrop-blur-md transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/85 disabled:opacity-50"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </button>
            </DropdownMenuPrimitive.Trigger>
            <DropdownMenuPrimitive.Portal>
              <DropdownMenuPrimitive.Content
                align="end"
                sideOffset={6}
                aria-label="账号更多操作"
                className="macos-glass-modal z-50 w-48 rounded-2xl p-1.5 text-[var(--text-primary)]"
              >
                <DropdownMenuPrimitive.Item
                  onSelect={onViewAudit}
                  className={menuItemClass}
                >
                  <FileText className="size-4 text-[var(--accent)]" />
                  <span>查看完整审计</span>
                </DropdownMenuPrimitive.Item>
                {onMarkLoggedIn && !account.deleted_at && (
                  <DropdownMenuPrimitive.Item
                    onSelect={onMarkLoggedIn}
                    className={menuItemClass}
                  >
                    <CheckCircle2 className="size-4 text-[var(--accent)]" />
                    <span>标记今天已登录</span>
                  </DropdownMenuPrimitive.Item>
                )}
                {onMarkVerified && !account.deleted_at && (
                  <DropdownMenuPrimitive.Item
                    onSelect={onMarkVerified}
                    className={menuItemClass}
                  >
                    <CheckCircle2 className="size-4 text-[var(--success)]" />
                    <span>标记今天已验证</span>
                  </DropdownMenuPrimitive.Item>
                )}
                {canUnarchive && onUnarchive && (
                  <DropdownMenuPrimitive.Item
                    onSelect={onUnarchive}
                    className={cn(menuItemClass, 'text-[var(--accent-text)]')}
                  >
                    <RotateCcw className="size-4" />
                    <span>取消归档</span>
                  </DropdownMenuPrimitive.Item>
                )}
                <DropdownMenuPrimitive.Item
                  disabled={!canRestore}
                  onSelect={onRestore}
                  className={cn(
                    menuItemClass,
                    !canRestore && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <RotateCcw className="size-4 text-[var(--text-secondary)]" />
                  <span>从回收站恢复</span>
                </DropdownMenuPrimitive.Item>
                <DropdownMenuPrimitive.Separator className="my-1 h-px bg-[var(--table-divider)]" />
                <DropdownMenuPrimitive.Item
                  disabled={Boolean(account.deleted_at)}
                  onSelect={onDelete}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] text-[var(--danger-text)] outline-none transition-colors data-[highlighted]:bg-[var(--danger-soft)] focus:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Trash2 className="size-4" />
                  <span>删除</span>
                </DropdownMenuPrimitive.Item>
              </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
          </DropdownMenuPrimitive.Root>
        </div>
      </div>
    </GlassPanel>
  );
}
