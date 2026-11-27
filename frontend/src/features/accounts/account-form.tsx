import { useState } from 'react';
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
import {
  AccountAppsEditor,
  type CreateAppHandler,
  type FetchAppIconHandler,
} from './account-apps-editor';
import { factorLabels, localDate, statusLabels } from './constants';
import { isMaskedPasswordPlaceholder } from './detail/use-password-secret';

export { factorLabels, localDate, statusLabels };
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

export function AccountForm({
  account,
  onFailure,
  tags,
  appsCatalog = [],
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
  const [clearPhone, setClearPhone] = useState(false);
  const [clearNotes, setClearNotes] = useState(false);
  const encryptedPhoneHidden = Boolean(account?.has_phone && !account.phone);
  const encryptedNotesHidden = Boolean(account?.has_notes && !account.notes);
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
  return (
    <form
      className="flex min-h-0 flex-col"
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
        if (values.phone) {
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
          purpose: values.purpose || null,
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
        if (encryptedPhoneHidden && !values.phone && !clearPhone) {
          Reflect.deleteProperty(body, 'phone');
        } else if (clearPhone) {
          body.phone = null;
        }
        if (encryptedNotesHidden && !values.notes && !clearNotes) {
          Reflect.deleteProperty(body, 'notes');
        } else if (clearNotes) {
          body.notes = null;
        }
        setValue('password', '');
        await onSubmit(body);
      })}
    >
      <FieldGroup className="min-h-0 gap-5 overflow-y-auto px-1 py-1 pr-3">
        <Field>
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
          <FieldLabel htmlFor="account-password">
            Gmail 登录密码{account ? '（留空保留原值）' : ''}
          </FieldLabel>
          <Input
            id="account-password"
            type="password"
            required={!account}
            maxLength={1024}
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
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
                errors.recovery_email_external ? 'recovery-error' : undefined
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
        ) : null}
        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="phone">
            绑定手机号{encryptedPhoneHidden ? '（留空保留原值）' : ''}
          </FieldLabel>
          <Input
            id="phone"
            type="tel"
            maxLength={32}
            pattern={String.raw`\+?[0-9 \(\)\-]{6,31}`}
            autoComplete="off"
            disabled={clearPhone}
            placeholder={
              encryptedPhoneHidden
                ? '已加密保存，留空保留原值；输入新手机号将覆盖'
                : undefined
            }
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? 'phone-error' : undefined}
            {...register('phone')}
          />
          {encryptedPhoneHidden && (
            <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearPhone}
                onChange={(e) => {
                  setClearPhone(e.target.checked);
                  if (e.target.checked) setValue('phone', '');
                }}
              />
              清空已保存的绑定手机号
            </label>
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
        <div className="grid grid-cols-2 gap-4">
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
        </div>
        <Field>
          <FieldLabel htmlFor="purpose">账号用途</FieldLabel>
          <Input id="purpose" maxLength={100} {...register('purpose')} />
        </Field>
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
        {(
          [
            ['last_login_at', '最后登录时间'],
            ['last_verified_at', '最后验证时间'],
            ['password_changed_at', '密码修改时间'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key}>
            <FieldLabel htmlFor={key}>{label}</FieldLabel>
            <Input id={key} type="datetime-local" step="1" {...register(key)} />
          </Field>
        ))}
        <Field>
          <FieldLabel htmlFor="notes">
            敏感备注{encryptedNotesHidden ? '（留空保留原值）' : ''}
          </FieldLabel>
          <Textarea
            id="notes"
            rows={4}
            maxLength={20000}
            disabled={clearNotes}
            placeholder={
              encryptedNotesHidden
                ? '已加密保存，留空保留原值；输入新备注将覆盖'
                : undefined
            }
            {...register('notes')}
          />
          {encryptedNotesHidden && (
            <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearNotes}
                onChange={(e) => {
                  setClearNotes(e.target.checked);
                  if (e.target.checked) setValue('notes', '');
                }}
              />
              清空已保存的敏感备注
            </label>
          )}
          <FieldDescription>
            手机号和备注以加密形式保存且按需二次验证查看；修改已有密码同样需要最近重新验证。
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--table-divider)] bg-transparent pt-4">
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
