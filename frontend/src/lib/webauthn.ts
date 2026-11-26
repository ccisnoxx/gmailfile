import {
  authWebauthnStepUpOptions,
  authWebauthnStepUpVerify,
  type SessionResponse,
} from '@/api/generated';

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' &&
    typeof navigator.credentials?.get === 'function'
  );
}

export function base64UrlToBuffer(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bufferToBase64Url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

type RawDescriptor = {
  id: string;
  type: PublicKeyCredentialType;
  transports?: AuthenticatorTransport[];
};

export async function createPasskeyCredential(
  rawOptions: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!isWebAuthnSupported()) {
    throw new Error('当前浏览器不支持 WebAuthn / 通行密钥（Passkey）。');
  }
  const user = rawOptions.user as Record<string, unknown>;
  const exclude =
    (rawOptions.excludeCredentials as RawDescriptor[] | undefined) ?? [];

  const publicKey: PublicKeyCredentialCreationOptions = {
    ...(rawOptions as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64UrlToBuffer(String(rawOptions.challenge ?? '')),
    user: {
      ...(user as unknown as PublicKeyCredentialUserEntity),
      id: base64UrlToBuffer(String(user?.id ?? '')),
    },
    excludeCredentials: exclude.map((item) => ({
      ...item,
      id: base64UrlToBuffer(item.id),
    })),
  };

  const created = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!created) {
    throw new DOMException('未收到通行密钥响应', 'NotAllowedError');
  }
  const response = created.response as AuthenticatorAttestationResponse & {
    getTransports?: () => string[];
  };

  return {
    id: created.id,
    rawId: bufferToBase64Url(created.rawId),
    type: created.type,
    authenticatorAttachment:
      (
        created as PublicKeyCredential & {
          authenticatorAttachment?: string | null;
        }
      ).authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      transports:
        typeof response.getTransports === 'function'
          ? response.getTransports()
          : [],
    },
  };
}

export async function getPasskeyAssertion(
  rawOptions: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!isWebAuthnSupported()) {
    throw new Error('当前浏览器不支持 WebAuthn / 通行密钥（Passkey）。');
  }
  const allow =
    (rawOptions.allowCredentials as RawDescriptor[] | undefined) ?? [];

  const publicKey: PublicKeyCredentialRequestOptions = {
    ...(rawOptions as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64UrlToBuffer(String(rawOptions.challenge ?? '')),
    allowCredentials:
      allow.length > 0
        ? allow.map((item) => ({
            ...item,
            id: base64UrlToBuffer(item.id),
          }))
        : undefined,
  };

  const assertion = (await navigator.credentials.get({
    publicKey,
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new DOMException('未收到通行密钥验证响应', 'NotAllowedError');
  }
  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    id: assertion.id,
    rawId: bufferToBase64Url(assertion.rawId),
    type: assertion.type,
    authenticatorAttachment:
      (
        assertion as PublicKeyCredential & {
          authenticatorAttachment?: string | null;
        }
      ).authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? bufferToBase64Url(response.userHandle)
        : null,
    },
  };
}

export async function performPasskeyStepUp(
  csrfToken: string,
): Promise<SessionResponse> {
  const headers = { 'X-CSRF-Token': csrfToken };
  const opt = await authWebauthnStepUpOptions({
    headers,
    throwOnError: true,
  });
  const credential = await getPasskeyAssertion(opt.data.options);
  const verified = await authWebauthnStepUpVerify({
    body: {
      challenge_id: opt.data.challenge_id,
      credential,
    },
    headers,
    throwOnError: true,
  });
  return verified.data;
}

export function formatWebAuthnError(error: unknown): string {
  const apiMessage = (error as { error?: { message?: string } } | null)?.error
    ?.message;
  if (apiMessage) return apiMessage;

  if (
    error instanceof DOMException ||
    (error && typeof error === 'object' && 'name' in error)
  ) {
    const name = String((error as { name?: string }).name ?? '');
    if (name === 'NotAllowedError') {
      return '已取消通行密钥验证或操作超时，请重试。';
    }
    if (name === 'InvalidStateError') {
      return '该设备上的通行密钥已绑定过，无需重复注册。';
    }
    if (name === 'SecurityError') {
      return '当前站点来源不支持通行密钥，请通过 HTTPS 或受信任同源地址访问。';
    }
    if (name === 'NotSupportedError') {
      return '当前浏览器或设备不支持所选通行密钥认证器。';
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return '通行密钥操作失败，请检查设备与浏览器权限后重试。';
}
