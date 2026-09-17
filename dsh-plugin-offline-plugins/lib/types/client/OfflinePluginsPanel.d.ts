/** Offline-plugins sidebar footer entry: export/import panel. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { OfflinePluginsApi } from './offline-plugins-api.ts';
export interface OfflinePluginsInjected {
    readonly api: OfflinePluginsApi;
}
export type OfflinePluginsPanelProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'offline-plugins'> & InjectFace<OfflinePluginsInjected>;
export declare function OfflinePluginsPanel(props: OfflinePluginsPanelProps): import("react").JSX.Element;
