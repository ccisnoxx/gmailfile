export {
  DisplaySettingsPopover,
  MacSwitch,
  type DisplaySettingsState,
} from '@/components/macos';
export {
  AccountBasicInfoForm,
  createDraftFromAccount,
  isDraftDirty,
  type AccountBasicInfoDraft,
} from './account-basic-info-form';
export {
  AccountDetailPage,
  AccountDetailPreviewPage,
  type AccountDetailPageProps,
  type AccountDetailPreviewProps,
} from './account-detail-page';
export { AccountHeaderCard } from './account-header-card';
export {
  AccountListPane,
  type AccountListFilterTab,
} from './account-list-pane';
export { AccountMasterDetailLayout } from './account-master-detail-layout';
export { AccountOverviewCard } from './account-overview-card';
export { AccountTabs, type AccountDetailTabKey } from './account-tabs';
export {
  ActivityTimeline,
  type ActivityTimelineItem,
} from './activity-timeline';
export {
  createDetailMockAccounts,
  createDetailMockTimelines,
  DETAIL_DEFAULT_ACCOUNT_ID,
  DETAIL_MOCK_LAST_BACKUP,
  DETAIL_MOCK_TAGS,
  DETAIL_MOCK_TOTAL_COUNT,
  DETAIL_MOCK_TRASH_COUNT,
  formatDetailDateTime,
  maskPhoneNumber,
} from './detail-mock-fixtures';
