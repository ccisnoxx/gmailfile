import type {
  ActiveSessionRow,
  SensitiveVerifyPayload,
  SettingsActionResult,
  SettingsMutationHandlers,
  WebAuthnCredentialRow,
} from './types';

export type PendingSensitiveAction =
  | { kind: 'terminate-session'; session: ActiveSessionRow }
  | { kind: 'logout-others' }
  | { kind: 'reverify' }
  | { kind: 'register-webauthn'; label: string }
  | { kind: 'delete-webauthn'; credential: WebAuthnCredentialRow }
  | { kind: 'disable-totp' };

export type SensitiveDialogConfig = {
  title: string;
  description: string;
  riskSummary: string;
  riskPoints: string[];
  confirmLabel: string;
  tone: 'danger' | 'primary';
  requireTotp: boolean;
  alwaysRequireCredentials: boolean;
  onConfirm: (verify?: SensitiveVerifyPayload) => Promise<SettingsActionResult>;
};

export function buildSensitiveDialogConfig({
  action,
  requireTotp,
  handlers,
}: {
  action: PendingSensitiveAction | null;
  requireTotp: boolean;
  handlers: SettingsMutationHandlers;
}): SensitiveDialogConfig | null {
  if (!action) return null;

  if (action.kind === 'terminate-session') {
    const target = action.session;
    return {
      title: target.current ? '终止当前管理会话？' : '终止活动会话？',
      description: `${target.deviceBrowser} · ${target.ipAddress}`,
      riskSummary: target.current
        ? '终止当前会话将立即退出控制台并清空本地工作区内存状态。'
        : `终止后，${target.deviceBrowser} 上的管理员登录状态将立即失效。`,
      riskPoints: [
        '该终端需要重新输入密码与 TOTP 验证码方可再次登录',
        '操作将记录至防篡改审计日志链',
      ],
      confirmLabel: target.current ? '确认退出当前会话' : '确认终止会话',
      tone: 'danger',
      requireTotp,
      alwaysRequireCredentials: false,
      onConfirm: (verify) => handlers.terminateSession(target.id, verify),
    };
  }

  if (action.kind === 'logout-others') {
    return {
      title: '退出全部其他会话？',
      description: '保留当前终端，立即撤销所有其他设备上的已登录会话',
      riskSummary:
        '其他所有已登录的浏览器和设备将被强制下线，不会延长当前会话的有效期。',
      riskPoints: [
        '若怀疑凭据泄露，建议同时修改管理员密码并重新生成恢复码',
        '撤销结果将以服务端响应为准，失败时不会自动重试',
      ],
      confirmLabel: '确认退出其他会话',
      tone: 'danger',
      requireTotp,
      alwaysRequireCredentials: false,
      onConfirm: (verify) => handlers.logoutOtherSessions(verify),
    };
  }

  if (action.kind === 'register-webauthn') {
    return {
      title: '验证后绑定新通行密钥',
      description: `设备名称：${action.label}`,
      riskSummary:
        '绑定新的 WebAuthn/Passkey 属于高敏操作，需先完成最近 5 分钟内的身份二次验证。',
      riskPoints: [
        '新绑定的通行密钥可直接用于无密码登录与高风险 Step-Up 验证',
        '操作将记录至防篡改审计日志链',
      ],
      confirmLabel: '验证并开始绑定',
      tone: 'primary',
      requireTotp,
      alwaysRequireCredentials: false,
      onConfirm: (verify) =>
        handlers.registerWebAuthnCredential(action.label, verify),
    };
  }

  if (action.kind === 'delete-webauthn') {
    const target = action.credential;
    return {
      title: '移除通行密钥？',
      description: target.label,
      riskSummary: `移除后，通行密钥「${target.label}」将立即失效，无法再用于登录或 Step-Up 验证。`,
      riskPoints: [
        '当 TOTP 未启用时，系统会保护最后一个通行密钥不被删除',
        '操作将记录至防篡改审计日志链',
      ],
      confirmLabel: '确认移除通行密钥',
      tone: 'danger',
      requireTotp,
      alwaysRequireCredentials: false,
      onConfirm: (verify) =>
        handlers.deleteWebAuthnCredential(target.id, verify),
    };
  }

  if (action.kind === 'disable-totp') {
    return {
      title: '停用 TOTP 验证器？',
      description: '仅保留已绑定的通行密钥（Passkey）与离线恢复码作为二步验证',
      riskSummary:
        '停用 TOTP 后将清除服务端 TOTP 密钥并退出全部其他设备会话，日常登录请使用通行密钥。',
      riskPoints: [
        '停用前必须确保至少保留 1 个可用的通行密钥（Passkey）',
        '离线恢复/数据库切换脚本将自动改用一次性恢复码作为二步兜底',
      ],
      confirmLabel: '确认停用 TOTP',
      tone: 'danger',
      requireTotp,
      alwaysRequireCredentials: false,
      onConfirm: (verify) => handlers.disableTotp(verify),
    };
  }

  return {
    title: '管理员身份重新验证',
    description: '完成验证后 5 分钟内可执行高风险安全配置操作',
    riskSummary: '请提供当前管理员凭据以开启 5 分钟高风险操作授权窗口。',
    riskPoints: ['凭据仅用于当次服务端校验，绝不写入缓存或本地存储'],
    confirmLabel: '完成重新验证',
    tone: 'primary',
    requireTotp,
    alwaysRequireCredentials: true,
    onConfirm: (verify) =>
      handlers.reverify(verify?.password ?? '', verify?.totpCode),
  };
}
