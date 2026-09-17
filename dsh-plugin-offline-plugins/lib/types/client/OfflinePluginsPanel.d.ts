/** Offline-plugins settings section: inline export/import management UI. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { OfflinePluginsApi } from './offline-plugins-api.ts';
export interface OfflinePluginsInjected {
    readonly api: OfflinePluginsApi;
}
export type OfflinePluginsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'offline-plugins'> & InjectFace<OfflinePluginsInjected>;
export declare function OfflinePluginsSection(props: OfflinePluginsSectionProps): import("react").JSX.Element;
