/**
 * Offline-plugins settings section: inline export/import management UI.
 *
 * The layout follows the shipped Plugins settings page: a titled section, one
 * card per installed plugin, and a dashed "place a thing here" affordance for
 * the import flow that ends the page.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { OfflinePluginsApi } from './offline-plugins-api.ts';
export interface OfflinePluginsInjected {
    readonly api: OfflinePluginsApi;
}
export type OfflinePluginsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'offline-plugins'> & InjectFace<OfflinePluginsInjected>;
export declare function OfflinePluginsSection(props: OfflinePluginsSectionProps): import("react").JSX.Element;
