import { useState } from 'react';
import { ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { RecoverySelector } from './recovery-selector';
import { useForm } from 'react-hook-form';
import type {
  AccountAppInput,
  AccountCreateWritable,
  AccountDetail,
  RegisteredAppResponse,
  TagResponse,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import {
  AccountAppsEditor,
  type CreateAppHandler,
  type FetchAppIconHandler,
} from './account-apps-editor';
import { factorLabels, localDate, statusLabels } from './constants';
import { isMaskedPasswordPlaceholder } from './detail/use-password-secret';
import { PasswordGeneratorPopover } from './password-generator-popover';

export { factorLabels, localDate, statusLabels };

type SecretFieldAction = 'keep' | 'replace' | 'clear';

const SECRET_ACTION_OPTIONS: readonly {
  value: SecretFieldAction;
  label: string;
}[] = [
  { value: 'keep', label: '保留原值' },
  { value: 'replace', label: '替换' },
  { value: 'clear', label: '清空' },
];

const inputDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
};

type Form = Omit<
  AccountCreateWritable,
  | 'registered_at'
  | 'recovery_account_id'
  | 'recovery_email_external'
  | 'tag_ids'
  | 'apps'
> & {
  registered_at: string;
  recovery_mode: 'none' | 'external' | 'account';
  recovery_account_id: string;
  recovery_email_external: string;
  tag_ids: string[];
};

function SecretFieldTriState({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: SecretFieldAction;
  onChange: (next: SecretFieldAction) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={`${label}变更策略`}
      className="inline-flex w-fit items-center gap-0.5 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-0.5"
    >
      {SECRET_ACTION_OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-7 rounded-lg px-2.5 text-xs font-medium transition-colors',
              active
                ? option.value === 'clear'
                  ? 'bg-[var(--danger)] text-white'
                  : 'bg-[var(--accent)] text-[var(--primary-foreground)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function AccountForm({
  account,
  onFailure,
  tags,
  appsCatalog = [],
  purposeSuggestions = [],
  onCreateApp,
  onFetchAppIcon,
  busy,
  conflict,
  onSubmit,
  onCancel,
}: {
  account?: AccountDetail;
  onFailure: (error: unknown) => void;
  tags: TagResponse[];
  appsCatalog?: RegisteredAppResponse[];
  purposeSuggestions?: string[];
  onCreateApp?: CreateAppHandler;
  onFetchAppIcon?: FetchAppIconHandler;
  busy: boolean;
  conflict: boolean;
  onSubmit: (body: AccountCreateWritable) => Promise<void>;
  onCancel: () => void;
}) {
  const [selectedApps, setSelectedApps] = useState<AccountAppInput[]>(
    () =>
      account?.apps?.map((item) => ({
        app_id: item.app_id,
        status: item.status,
        note: item.note ?? null,
      })) ?? [],
  );
  const encryptedPhoneHidden = Boolean(account?.has_phone && !account.phone);
  const encryptedNotesHidden = Boolean(account?.has_notes && !account.notes);
  const [phoneAction, setPhoneAction] = useState<SecretFieldAction>(
    encryptedPhoneHidden ? 'keep' : 'replace',
  );
  const [notesAction, setNotesAction] = useState<SecretFieldAction>(
    encryptedNotesHidden ? 'keep' : 'replace',
  );
  const [activityExpanded, setActivityExpanded] = useState(false);

  const filledActivityCount = [
    account?.last_login_at,
    account?.last_verified_at,
    account?.password_changed_at,
  ].filter(Boolean).length;

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
    setValue,
  } = useForm<Form>({
    defaultValues: {
      gmail_email: account?.gmail_email ?? '',
      password: '',
      registered_at: inputDate(
        account?.registered_at ?? new Date().toISOString(),
      ),
      recovery_mode: account?.recovery_account_id
        ? 'account'
        : account?.recovery_email_external
          ? 'external'
          : account
            ? 'none'
            : 'external',
      recovery_account_id: account?.recovery_account_id ?? '',
      recovery_email_external: account?.recovery_email_external ?? '',
      phone: account?.phone ?? '',
      status: account?.status ?? 'pending_verification',
      two_factor_status: account?.two_factor_status ?? 'unknown',
      purpose: account?.purpose ?? '',
      tag_ids: account?.tags.map((t) => t.id) ?? [],
      last_login_at: inputDate(account?.last_login_at),
      last_verified_at: inputDate(account?.last_verified_at),
      password_changed_at: inputDate(account?.password_changed_at),
      notes: account?.notes ?? '',
    },
  });
  const mode = watch('recovery_mode');
  const sectionClass =
    'space-y-4 rounded-2xl border border-[var(--surface-control-border)] bg-[var(--surface-control)]/70 p-4';

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={handleSubmit(async (values) => {
        const normalize = (email: string) => {
          let [local, domain] = email.trim().toLowerCase().split('@');
          if (domain === 'gmail.com' || domain === 'googlemail.com') {
            local = local.split('+')[0].replaceAll('.', '');
            domain = 'gmail.com';
          }
          return `${local}@${domain}`;
        };
        if (values.password && isMaskedPasswordPlaceholder(values.password)) {
          setError('password', {
            message: '请填写真实密码，不要填写星号或圆点掩码占位符。',
          });
          return;
        }
        const shouldValidatePhone =
          !encryptedPhoneHidden || phoneAction === 'replace';
        if (shouldValidatePhone && values.phone) {
          const digits = values.phone.replace(/\D/g, '');
          if (digits.length < 6 || digits.length > 20) {
            setError('phone', {
              message: '绑定手机号需包含 6 至 20 位数字。',
            });
            return;
          }
        }
        const trimmedRecoveryExternal = values.recovery_email_external.trim();
        if (
          mode === 'external' &&
          trimmedRecoveryExternal &&
          normalize(values.gmail_email) === normalize(trimmedRecoveryExternal)
        ) {
          setError('recovery_email_external', {
            message: '辅助邮箱不能与主邮箱相同',
          });
          return;
        }
        const body: AccountCreateWritable = {
          ...values,
          registered_at: new Date(values.registered_at).toISOString(),
          recovery_account_id:
            mode === 'account' && values.recovery_account_id
              ? values.recovery_account_id
              : null,
          recovery_email_external:
            mode === 'external' && trimmedRecoveryExternal
              ? trimmedRecoveryExternal
              : null,
          phone: values.phone || null,
          purpose: values.purpose?.trim() || null,
          notes: values.notes || null,
          apps: selectedApps.map((item) => ({
            app_id: item.app_id,
            status: item.status ?? 'active',
            note: item.note?.trim() || null,
          })),
          last_login_at: values.last_login_at
            ? new Date(values.last_login_at).toISOString()
            : null,
          last_verified_at: values.last_verified_at
            ? new Date(values.last_verified_at).toISOString()
            : null,
          password_changed_at: values.password_changed_at
            ? new Date(values.password_changed_at).toISOString()
            : null,
        };
        // 表单的辅助模式不属于 API 合同；密码与未修改的已加密手机号/备注从不误清空。
        Reflect.deleteProperty(body, 'recovery_mode');
        if (encryptedPhoneHidden) {
          if (
            phoneAction === 'keep' ||
            (phoneAction === 'replace' && !values.phone)
          ) {
            Reflect.deleteProperty(body, 'phone');
          } else if (phoneAction === 'clear') {
            body.phone = null;
          }
        }
        if (encryptedNotesHidden) {
          if (
            notesAction === 'keep' ||
            (notesAction === 'replace' && !values.notes)
          ) {
            Reflect.deleteProperty(body, 'notes');
          } else if (notesAction === 'clear') {
            body.notes = null;
          }
        }
        setValue('password', '');
        await onSubmit(body);
      })}
    >
      <FieldGroup className="min-h-0 flex-1 gap-4 overflow-y-auto px-1 py-1 pr-2">
        {/* 分组 1：基本信息 */}
        <section aria-label="基本信息" className={sectionClass}>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
            基本信息
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="account-email">Gmail 地址</FieldLabel>
              <Input
                id="account-email"
                type="email"
                required
                maxLength={254}
                autoComplete="off"
                {...register('gmail_email')}
              />
            </Field>
            <Field data-invalid={!!errors.password}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="account-password">
                  Gmail 登录密码{account ? '（留空保留原值）' : ''}
                </FieldLabel>
                <PasswordGeneratorPopover
                  disabled={busy}
                  onApply={(pwd) =>
                    setValue('password', pwd, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                />
              </div>
              <Input
                id="account-password"
                type="password"
                required={!account}
                maxLength={1024}
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                aria-describedby={
                  errors.password ? 'password-error' : undefined
                }
                {...register('password')}
              />
              {errors.password && (
                <p
                  id="password-error"
                  role="alert"
                  className="text-sm text-[var(--danger-text)]"
                >
                  {errors.password.message}
                </p>
              )}
              <FieldDescription>
                不会读取现有密码，也不要填写掩码占位符。
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="registered">注册时间</FieldLabel>
              <Input
                id="registered"
                type="datetime-local"
                step="1"
                required
                {...register('registered_at')}
              />
              <FieldDescription>
                按当前浏览器时区填写，保存时转为 UTC。
              </FieldDescription>
            </Field>
          </div>
        </section>

        {/* 分组 2：恢复与安全 */}
        <section aria-label="恢复与安全" className={sectionClass}>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
            恢复与安全
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="recovery-mode">辅助邮箱方式</FieldLabel>
              <NativeSelect id="recovery-mode" {...register('recovery_mode')}>
                <NativeSelectOption value="external">
                  填写邮箱地址
                </NativeSelectOption>
                <NativeSelectOption value="account">
                  关联已有账号
                </NativeSelectOption>
                <NativeSelectOption value="none">暂不设置</NativeSelectOption>
              </NativeSelect>
            </Field>
            {mode === 'external' ? (
              <Field data-invalid={!!errors.recovery_email_external}>
                <FieldLabel htmlFor="recovery-email">辅助邮箱</FieldLabel>
                <Input
                  id="recovery-email"
                  type="email"
                  placeholder="留空表示暂不设置辅助邮箱"
                  maxLength={254}
                  aria-invalid={!!errors.recovery_email_external}
                  aria-describedby={
                    errors.recovery_email_external
                      ? 'recovery-error'
                      : undefined
                  }
                  {...register('recovery_email_external')}
                />
                {errors.recovery_email_external && (
                  <p
                    id="recovery-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errors.recovery_email_external.message}
                  </p>
                )}
                <FieldDescription>
                  可选；留空表示暂不设置辅助邮箱。
                </FieldDescription>
              </Field>
            ) : mode === 'account' ? (
              <Field>
                <FieldLabel htmlFor="recovery-account">关联账号</FieldLabel>
                <RecoverySelector
                  account={account}
                  value={watch('recovery_account_id')}
                  onChange={(value) => setValue('recovery_account_id', value)}
                  onFailure={onFailure}
                />
              </Field>
            ) : (
              <div className="flex items-end pb-2 text-xs text-[var(--text-secondary)]">
                当前暂不关联任何辅助邮箱。
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="status">账号状态</FieldLabel>
              <NativeSelect id="status" {...register('status')}>
                {Object.entries(statusLabels).map(([key, label]) => (
                  <NativeSelectOption key={key} value={key}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="two-factor">二步验证状态</FieldLabel>
              <NativeSelect id="two-factor" {...register('two_factor_status')}>
                {Object.entries(factorLabels).map(([key, label]) => (
                  <NativeSelectOption key={key} value={key}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <Field data-invalid={!!errors.phone} className="sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="phone">
                  绑定手机号{encryptedPhoneHidden ? '（已加密保存）' : ''}
                </FieldLabel>
                {encryptedPhoneHidden && (
                  <SecretFieldTriState
                    label="绑定手机号"
                    value={phoneAction}
                    disabled={busy || conflict}
                    onChange={(next) => {
                      setPhoneAction(next);
                      if (next !== 'replace') setValue('phone', '');
                    }}
                  />
                )}
              </div>
              {(!encryptedPhoneHidden || phoneAction === 'replace') && (
                <Input
                  id="phone"
                  type="tel"
                  maxLength={32}
                  pattern={String.raw`\+?[0-9 \(\)\-]{6,31}`}
                  autoComplete="off"
                  placeholder={
                    encryptedPhoneHidden
                      ? '输入新的绑定手机号以覆盖原值'
                      : undefined
                  }
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? 'phone-error' : undefined}
                  {...register('phone')}
                />
              )}
              {encryptedPhoneHidden && phoneAction === 'keep' && (
                <FieldDescription>
                  已加密保存；保持“保留原值”不会修改或读取现有手机号。
                </FieldDescription>
              )}
              {encryptedPhoneHidden && phoneAction === 'clear' && (
                <p
                  role="status"
                  className="text-xs font-medium text-[var(--danger-text)]"
                >
                  保存后将清空已保存的绑定手机号。
                </p>
              )}
              {errors.phone && (
                <p
                  id="phone-error"
                  role="alert"
                  className="text-sm text-[var(--danger-text)]"
                >
                  {errors.phone.message}
                </p>
              )}
            </Field>
          </div>
        </section>

        {/* 分组 3：分类与关系 */}
        <section aria-label="分类与关系" className={sectionClass}>
          <h3 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
            分类与关系
          </h3>
          <Field>
            <FieldLabel htmlFor="purpose">账号用途</FieldLabel>
            <Input
              id="purpose"
              list="account-form-purpose-options"
              placeholder={
                purposeSuggestions.length > 0
                  ? '可选择已有用途或填写规范描述'
                  : '例如：主工作区 / 云服务 / 开发测试'
              }
              maxLength={100}
              {...register('purpose')}
            />
            {purposeSuggestions.length > 0 && (
              <datalist id="account-form-purpose-options">
                {purposeSuggestions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            )}
          </Field>
          <FieldSet>
            <FieldLegend>标签</FieldLegend>
            <div className="flex flex-wrap gap-4">
              {tags.length ? (
                tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      value={t.id}
                      {...register('tag_ids')}
                    />
                    {t.name}
                  </label>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  还没有标签，可在列表中管理。
                </p>
              )}
            </div>
          </FieldSet>
          <FieldSet>
            <FieldLegend>已注册应用与状态</FieldLegend>
            <AccountAppsEditor
              catalog={appsCatalog}
              value={selectedApps}
              onChange={setSelectedApps}
              onCreateApp={onCreateApp}
              onFetchAppIcon={onFetchAppIcon}
              disabled={busy || conflict}
            />
          </FieldSet>
        </section>

        {/* 分组 4：活动时间（默认折叠，按需展开） */}
        <section aria-label="活动时间" className={sectionClass}>
          <button
            type="button"
            aria-expanded={activityExpanded}
            onClick={() => setActivityExpanded((open) => !open)}
            className="flex min-h-7 w-full items-center justify-between text-left text-xs font-semibold tracking-wide text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <span>
              活动时间（可选
              {filledActivityCount > 0
                ? ` · 已记录 ${filledActivityCount} 项`
                : ''}
              ）
            </span>
            {activityExpanded ? (
              <ChevronUp className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" aria-hidden="true" />
            )}
          </button>
          {activityExpanded && (
            <div className="grid gap-4 pt-1 sm:grid-cols-2">
              {(
                [
                  ['last_login_at', '最后登录时间'],
                  ['last_verified_at', '最后验证时间'],
                  ['password_changed_at', '密码修改时间'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={key}>{label}</FieldLabel>
                  <Input
                    id={key}
                    type="datetime-local"
                    step="1"
                    {...register(key)}
                  />
                </Field>
              ))}
            </div>
          )}
        </section>

        {/* 分组 5：敏感备注（独立高风险区） */}
        <section
          aria-label="敏感备注高风险区"
          className="space-y-3 rounded-2xl border border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)]/45 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--badge-orange-text)]">
              <ShieldAlert className="size-3.5" aria-hidden="true" />
              <span>敏感备注（字段级加密存储）</span>
            </div>
            {encryptedNotesHidden && (
              <SecretFieldTriState
                label="敏感备注"
                value={notesAction}
                disabled={busy || conflict}
                onChange={(next) => {
                  setNotesAction(next);
                  if (next !== 'replace') setValue('notes', '');
                }}
              />
            )}
          </div>
          <Field>
            <FieldLabel htmlFor="notes" className="sr-only">
              敏感备注{encryptedNotesHidden ? '（已加密保存）' : ''}
            </FieldLabel>
            {(!encryptedNotesHidden || notesAction === 'replace') && (
              <Textarea
                id="notes"
                rows={4}
                maxLength={20000}
                placeholder={
                  encryptedNotesHidden
                    ? '输入新的敏感备注以覆盖原值'
                    : '填写需加密保管的补充信息（不参与列表模糊检索）'
                }
                {...register('notes')}
              />
            )}
            {encryptedNotesHidden && notesAction === 'keep' && (
              <FieldDescription>
                已加密保存；保持“保留原值”不会修改或读取现有敏感备注。
              </FieldDescription>
            )}
            {encryptedNotesHidden && notesAction === 'clear' && (
              <p
                role="status"
                className="text-xs font-medium text-[var(--danger-text)]"
              >
                保存后将清空已保存的敏感备注。
              </p>
            )}
            <FieldDescription>
              手机号和备注以 AES-256-GCM
              字段级密文保存，按需经二次验证解密查看；修改已有密码同样需要最近重新验证。
            </FieldDescription>
          </Field>
        </section>
      </FieldGroup>

      {/* 底部固定操作栏 */}
      <div className="sticky bottom-0 flex shrink-0 justify-end gap-3 border-t border-[var(--table-divider)] bg-[var(--surface-popover)]/95 pt-4 backdrop-blur-md">
        <Button type="button" variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={busy || conflict}>
          {busy ? '正在保存…' : '保存账号'}
        </Button>
      </div>
    </form>
  );
}
