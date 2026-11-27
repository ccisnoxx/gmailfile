import type { DisplaySettingsState } from '@/components/macos';
import type { PendingSensitiveAction } from '../sensitive-dialog-config';
import type { SettingsToast } from '../settings-layout';
import type { CardStateMode } from '../types';
import type { SettingsDataBundle } from '../use-settings-data';

export type SearchableCardId =
  | 'admin'
  | 'totp'
  | 'webauthn'
  | 'sessions'
  | 'backup'
  | 'audit'
  | 'retention'
  | 'appearance'
  | 'runtime';

export const CARD_SEARCH_INDEX: Record<SearchableCardId, string> = {
  admin: '管理员安全 admin 密码强度 16位 泄露密码 密码短语 修改密码 重新验证',
  totp: '双因素认证 totp 2fa google authenticator microsoft 备用恢复码 验证码 演示状态 停用',
  webauthn:
    '通行密钥 webauthn fido2 passkey touch id yubikey 硬件安全密钥 生物识别 无密码登录',
  sessions:
    '活动会话 设备 浏览器 macos safari windows chrome ip 登录时间 终止 退出其他会话',
  backup:
    '加密备份与恢复 pg_dump age 立即备份 恢复验证 结构 约束 抽样解密 异地备份',
  audit: '审计日志 登录成功 修改账号 自动备份 导出 csv 哈希链 合规',
  retention: '日志保留与数据生命周期 730 90 存储占用 调整策略 清理',
  appearance:
    '界面与体验 导航栏毛玻璃透明度 滑块 预览 紧凑模式 流动背景 动画 localstorage 深色模式 浅色 跟随系统 主题 pwa 安装 桌面应用',
  runtime: '系统与维护 版本 schema 自动锁定 空闲超时 运行状态 快捷键',
};

export function matchSettingsCardIds(query: string): SearchableCardId[] | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  return (Object.keys(CARD_SEARCH_INDEX) as SearchableCardId[]).filter((id) =>
    CARD_SEARCH_INDEX[id].toLowerCase().includes(normalized),
  );
}

export type SettingsSectionCommonProps = {
  mode: 'live' | 'mock';
  data: SettingsDataBundle;
  resolvedUiState?: CardStateMode;
  navAlpha: number;
  onNavAlphaChange: (next: number) => void;
  displaySettings: DisplaySettingsState;
  onDisplaySettingsChange: (next: DisplaySettingsState) => void;
  onOpenChangePassword: () => void;
  onOpenRecoveryCodes: () => void;
  onOpenTotpSetup: () => void;
  onOpenRestoreVerify: (archiveId?: string | null) => void;
  onOpenRetentionSheet: () => void;
  onRequestSensitiveAction: (action: PendingSensitiveAction) => void;
  onRunBackup: () => void;
  onViewFullAuditLog: () => void;
  showToast: (message: string, kind?: SettingsToast['kind']) => void;
};
