import { useCallback, useState } from 'react';
import {
  authRegenerateRecoveryCodes,
  authTotpConfirm,
  authTotpSetup,
} from '@/api/generated/sdk.gen';
import type {
  Credentials,
  RecoveryResponse,
  SetupResponse,
} from '@/api/generated';
import type { AuthMachine } from './use-auth-machine';

export function useTotpState() {
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const clear = useCallback(() => {
    setSetup(null);
    setCodes(null);
    setSaved(false);
  }, []);

  return { setup, setSetup, codes, setCodes, saved, setSaved, clear };
}

export type TotpState = ReturnType<typeof useTotpState>;

export function useTotpManager(auth: AuthMachine, state: TotpState) {
  const { setSetup, setCodes, setSaved, codes } = state;

  const acceptRecovery = useCallback(
    (result: RecoveryResponse, ticket: number) => {
      if (!auth.isCurrentTicket(ticket)) return;
      auth.setSession(result.session);
      setSetup(null);
      setSaved(false);
      setCodes(result.recovery_codes);
    },
    [auth, setCodes, setSaved, setSetup],
  );

  const startInitialSetup = useCallback(
    () =>
      auth.run(async (ticket) => {
        const result = await authTotpSetup({
          body: {},
          headers: auth.headers,
          throwOnError: true,
        });
        if (!auth.isCurrentTicket(ticket)) return;
        auth.setSession(result.data.session);
        setSetup(result.data);
      }),
    [auth, setSetup],
  );

  const startRebind = useCallback(
    (body: Credentials) =>
      auth.run(async (ticket) => {
        const result = await authTotpSetup({
          body,
          headers: auth.headers,
          throwOnError: true,
        });
        if (!auth.isCurrentTicket(ticket)) return;
        auth.setSession(result.data.session);
        setSetup(result.data);
      }),
    [auth, setSetup],
  );

  const confirmSetup = useCallback(
    (code: string) =>
      auth.run(async (ticket) => {
        const result = await authTotpConfirm({
          body: { code },
          headers: auth.headers,
          throwOnError: true,
        });
        acceptRecovery(result.data, ticket);
      }),
    [acceptRecovery, auth],
  );

  const regenerateRecoveryCodes = useCallback(
    (body: Credentials) =>
      auth.run(async (ticket) => {
        const result = await authRegenerateRecoveryCodes({
          body,
          headers: auth.headers,
          throwOnError: true,
        });
        acceptRecovery(result.data, ticket);
      }),
    [acceptRecovery, auth],
  );

  const downloadRecoveryCodes = useCallback(() => {
    if (!codes) return;
    const file = new Blob([codes.join('\n') + '\n'], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gmail-manager-recovery-codes.txt';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [codes]);

  return {
    setup: state.setup,
    codes: state.codes,
    saved: state.saved,
    setSaved: state.setSaved,
    startInitialSetup,
    startRebind,
    confirmSetup,
    regenerateRecoveryCodes,
    downloadRecoveryCodes,
  };
}
