import { useState } from 'react';
import {
  Check,
  Fingerprint,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { isWebAuthnSupported } from '@/lib/webauthn';
import { SettingsCardShell } from './settings-card-shell';
import type {
  CardStateMode,
  SettingsActionResult,
  WebAuthnCredentialRow,
} from './types';

const TRANSPORT_LABELS: Record<string, string> = {
  internal: '本机生物识别',
  hybrid: '跨设备漫游',
  usb: 'USB 安全密钥',
  nfc: 'NFC',
  ble: '蓝牙',
  'smart-card': '智能卡',
};

export function WebAuthnSecurityCard({
  credentials,
  totpEnabled,
  state = 'ready',
  errorText,
  onRegister,
  onRename,
  onDeleteRequest,
  onRetry,
}: {
  credentials: WebAuthnCredentialRow[];
  totpEnabled: boolean;
  state?: CardStateMode;
  errorText?: string | null;
  onRegister: (label: string) => Promise<SettingsActionResult>;
  onRename: (id: string, label: string) => Promise<SettingsActionResult>;
  onDeleteRequest: (row: WebAuthnCredentialRow) => void;
  onRetry?: () => void;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [registering, setRegistering] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [localError, setLocalError] = useState('');

  const supported = isWebAuthnSupported();
  const isLastFactor = !totpEnabled && credentials.length <= 1;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registering) return;
    setLocalError('');
    const label = newLabel.trim() || '本机通行密钥';
    setRegistering(true);
    try {
      const res = await onRegister(label);
      if (res.ok) {
        setNewLabel('');
      } else {
        setLocalError(res.error);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleRenameSubmit = async (id: string) => {
    const trimmed = editingLabel.trim();
    if (!trimmed || renaming) return;
    setLocalError('');
    setRenaming(true);
    try {
      const res = await onRename(id, trimmed);
      if (res.ok) {
        setEditingId(null);
        setEditingLabel('');
      } else {
        setLocalError(res.error);
      }
    } finally {
      setRenaming(false);
    }
  };

  return (
    <SettingsCardShell
      id="settings-card-webauthn"
      title="通行密钥（WebAuthn / Passkey）"
      subtitle="FIDO2 硬件密钥与平台生物识别，支持无密码登录与高风险 Step-Up 验证"
      icon={<Fingerprint className="size-4" />}
      state={state}
      loadingText="正在读取通行密钥列表…"
      errorText={errorText ?? undefined}
      onRetry={onRetry}
      headerRight={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1677ff]/25 bg-[var(--accent-soft)] px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-[var(--accent)]">
          <KeyRound className="size-3" aria-hidden="true" />
          <span>
            {credentials.length > 0
              ? `已绑定 ${credentials.length} 个`
              : '尚未绑定'}
          </span>
        </span>
      }
    >
      <div className="space-y-3.5">
        {credentials.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/35 px-3.5 py-3 text-[12.5px] leading-5 text-[var(--text-secondary)]">
            暂未绑定任何通行密钥。绑定 Touch ID、Windows Hello 或 YubiKey
            后，可一步完成无密码登录及高敏操作 Step-Up 认证，并可按需停用 TOTP。
          </div>
        ) : (
          <ul
            aria-label="已绑定的通行密钥列表"
            className="divide-y divide-[var(--table-divider)] rounded-2xl border border-white/75 bg-white/44"
          >
            {credentials.map((cred) => {
              const isEditing = editingId === cred.id;
              return (
                <li
                  key={cred.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[12.5px]"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          aria-label="修改通行密钥名称"
                          maxLength={80}
                          value={editingLabel}
                          disabled={renaming}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          className="h-8 w-full max-w-[220px] rounded-lg border border-[#cdddf0] bg-white/90 px-2.5 text-[12.5px] text-[var(--text-primary)]"
                        />
                        <button
                          type="button"
                          aria-label="保存密钥名称"
                          disabled={renaming || !editingLabel.trim()}
                          onClick={() => void handleRenameSubmit(cred.id)}
                          className="inline-flex size-7 items-center justify-center rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="取消重命名"
                          disabled={renaming}
                          onClick={() => setEditingId(null)}
                          className="inline-flex size-7 items-center justify-center rounded-lg border border-white/80 bg-white/70 text-[var(--text-secondary)]"
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-[var(--text-primary)]">
                          {cred.label}
                        </span>
                        {cred.transports.map((t) => (
                          <span
                            key={t}
                            className="rounded-md border border-[var(--border)] bg-white/60 px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
                          >
                            {TRANSPORT_LABELS[t] ?? t}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                      绑定于 {cred.createdAt}
                      {cred.lastUsedAt
                        ? ` · 最近使用 ${cred.lastUsedAt}`
                        : ' · 尚未使用'}
                    </p>
                  </div>

                  {!isEditing && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`重命名 ${cred.label}`}
                        onClick={() => {
                          setEditingId(cred.id);
                          setEditingLabel(cred.label);
                          setLocalError('');
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/85 bg-white/70 px-2 text-[11.5px] font-medium text-[var(--text-primary)] hover:bg-white"
                      >
                        <Pencil className="size-3" aria-hidden="true" />
                        <span>重命名</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除 ${cred.label}`}
                        disabled={isLastFactor}
                        title={
                          isLastFactor
                            ? '当前 TOTP 未启用，至少需保留 1 个通行密钥'
                            : '删除此通行密钥'
                        }
                        onClick={() => onDeleteRequest(cred)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#e45d5d]/30 bg-[#e45d5d]/[0.08] px-2 text-[11.5px] font-medium text-[#c54646] hover:bg-[#e45d5d]/[0.16] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Trash2 className="size-3" aria-hidden="true" />
                        <span>删除</span>
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={(e) => void handleRegister(e)}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            aria-label="新通行密钥名称"
            maxLength={80}
            disabled={registering || !supported}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="设备名称（如 MacBook Touch ID）"
            className="h-9 min-w-[180px] flex-1 rounded-xl border border-[#cdddf0] bg-white/80 px-3 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/80 focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={registering || !supported}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-[12.5px] font-medium text-white shadow-[0_4px_12px_rgba(22,119,255,0.22)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>{registering ? '等待认证器…' : '绑定新通行密钥'}</span>
          </button>
        </form>

        {!supported && (
          <p className="text-[11.5px] text-[var(--text-secondary)]">
            当前浏览器环境未检测到 WebAuthn API（需使用 HTTPS 或 localhost
            现代浏览器）。
          </p>
        )}

        {localError && (
          <p role="alert" className="text-[12px] text-[#c54646]">
            {localError}
          </p>
        )}
      </div>
    </SettingsCardShell>
  );
}
