import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { ChangePasswordInput, Credentials } from '@/api/generated';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type FormValues = Credentials &
  Partial<Pick<ChangePasswordInput, 'new_password'>>;

export function CredentialForm({
  kind,
  busy,
  requireStepUpTotp = false,
  onSubmit,
}: {
  kind: 'login' | 'reverify' | 'factor' | 'password';
  busy: boolean;
  requireStepUpTotp?: boolean;
  onSubmit: (value: FormValues) => Promise<void>;
}) {
  const id = useId();
  const [recovery, setRecovery] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm<FormValues>();
  const hasFactor = kind === 'login' || kind === 'factor';
  const hasStepUpTotp = kind === 'reverify' && requireStepUpTotp;
  const titles = {
    login: '登录',
    reverify: '重新验证',
    factor: '验证并继续',
    password: '修改密码并退出所有会话',
  };
  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        setShowPassword(false);
        setShowNewPassword(false);
        reset();
        await onSubmit(data);
      })}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-password`}>
            {kind === 'login' ? '管理员密码' : '当前管理员密码'}
          </FieldLabel>
          <div className="relative">
            <Input
              id={`${id}-password`}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={1024}
              disabled={busy}
              className="h-10 rounded-xl pr-10"
              {...register('password')}
            />
            <button
              type="button"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              disabled={busy}
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute top-1/2 right-2.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface-control-hover)] hover:text-foreground"
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </Field>
        {hasFactor && (
          <Field>
            <FieldLabel htmlFor={`${id}-factor`}>
              {recovery ? '恢复码' : 'TOTP 验证码'}
            </FieldLabel>
            {recovery ? (
              <Input
                key="recovery"
                id={`${id}-factor`}
                type="password"
                autoComplete="off"
                required
                maxLength={128}
                disabled={busy}
                className="h-10 rounded-xl"
                {...register('recovery_code')}
              />
            ) : (
              <Input
                key="totp"
                id={`${id}-factor`}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required={kind === 'factor'}
                disabled={busy}
                placeholder="6 位动态数字验证码"
                className="h-10 rounded-xl tracking-[0.2em] tabular-nums"
                {...register('totp_code')}
              />
            )}
            {kind === 'login' && !recovery && (
              <FieldDescription>
                首次登录可留空，随后必须绑定验证器。
              </FieldDescription>
            )}
            <Button
              type="button"
              variant="link"
              className="self-start px-0"
              disabled={busy}
              onClick={() => {
                setValue('totp_code', '');
                setValue('recovery_code', '');
                setRecovery(!recovery);
              }}
            >
              {recovery ? '改用验证器' : '使用恢复码'}
            </Button>
            {recovery && (
              <FieldDescription>
                {kind === 'login'
                  ? '使用后将退出其他会话，并要求重新绑定验证器。'
                  : '恢复码只能使用一次；操作完成后其他会话会被撤销。'}
              </FieldDescription>
            )}
          </Field>
        )}
        {hasStepUpTotp && (
          <Field>
            <FieldLabel htmlFor={`${id}-stepup-totp`}>TOTP 验证码</FieldLabel>
            <Input
              id={`${id}-stepup-totp`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={busy}
              {...register('totp_code')}
            />
            <FieldDescription>
              高风险敏感操作需提供当前 6 位 TOTP 验证码完成 step-up 验证。
            </FieldDescription>
          </Field>
        )}
        {kind === 'password' && (
          <Field>
            <FieldLabel htmlFor={`${id}-new`}>新密码</FieldLabel>
            <div className="relative">
              <Input
                id={`${id}-new`}
                type={showNewPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={16}
                maxLength={1024}
                required
                disabled={busy}
                className="h-10 rounded-xl pr-10"
                {...register('new_password')}
              />
              <button
                type="button"
                aria-label={showNewPassword ? '隐藏新密码' : '显示新密码'}
                disabled={busy}
                onClick={() => setShowNewPassword((prev) => !prev)}
                className="absolute top-1/2 right-2.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--surface-control-hover)] hover:text-foreground"
              >
                {showNewPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <FieldDescription>
              至少 16 个字符，建议使用多词长密码短语，避免常见泄露密码且不要与
              Gmail 密码复用。
            </FieldDescription>
          </Field>
        )}
        <Button
          type="submit"
          disabled={busy}
          className="h-10 w-full rounded-xl font-semibold shadow-[0_8px_20px_rgba(15,98,223,0.24)]"
        >
          {busy ? '正在验证…' : titles[kind]}
        </Button>
      </FieldGroup>
    </form>
  );
}
