import {
  SettingsPreviewPage,
  type SettingsSectionKey,
} from '@/features/settings';

export default function SettingsPreviewRoute({
  initialSection = 'security',
}: {
  initialSection?: SettingsSectionKey;
}) {
  return <SettingsPreviewPage initialSection={initialSection} />;
}
