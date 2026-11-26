import type { SetupResponse } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function TotpSetupCard({
  setup,
  epoch,
  busy,
  onConfirm,
  onCancel,
}: {
  setup: SetupResponse;
  epoch: number;
  busy: boolean;
  onConfirm: (code: string) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-7 text-muted-foreground">
        在验证器中扫描二维码，或手工输入
        Secret。输入验证码确认后才会启用。离开或隐藏页面会清除展示。
      </p>
      <div className="mx-auto rounded-2xl border border-[var(--border)] bg-white p-3 shadow-sm">
        <img
          src={setup.qr_data_url}
          width={224}
          height={224}
          alt="验证器绑定二维码"
          className="size-56"
        />
      </div>
      <Field>
        <FieldLabel htmlFor="totp-secret">手工 Secret</FieldLabel>
        <Input
          id="totp-secret"
          readOnly
          value={setup.secret}
          autoComplete="off"
          className="font-mono"
        />
      </Field>
      <form
        key={epoch}
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const code = String(new FormData(form).get('code'));
          form.reset();
          void onConfirm(code);
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="confirmation">验证器验证码</FieldLabel>
            <Input
              id="confirmation"
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              disabled={busy}
            />
          </Field>
          <Button disabled={busy}>{busy ? '正在确认…' : '确认绑定'}</Button>
        </FieldGroup>
      </form>
      <Button variant="ghost" disabled={busy} onClick={onCancel}>
        取消展示
      </Button>
    </div>
  );
}
