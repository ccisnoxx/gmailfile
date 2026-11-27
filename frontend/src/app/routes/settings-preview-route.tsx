import { SettingsPreviewPage } from '@/features/settings/settings-page';
import type { SettingsSectionKey } from '@/features/settings/types';

export default function SettingsPreviewRoute({
  initialSection = 'security',
}: {
  initialSection?: SettingsSectionKey;
}) {
  return <SettingsPreviewPage initialSection={initialSection} />;
}
