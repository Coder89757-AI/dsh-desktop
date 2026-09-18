/** One installed plugin card with its export action. */
import type { OfflinePluginEntry } from '../offline/contract.ts';
import type { OfflinePluginsLocaleKey } from './offline-plugins-locales.ts';
interface OfflinePluginsRowProps {
    readonly entry: OfflinePluginEntry;
    readonly t: (key: OfflinePluginsLocaleKey) => string;
    /** Another plugin's export is in flight; every row refuses a second run. */
    readonly busy: boolean;
    /** This plugin's own export is in flight, scanning included. */
    readonly active: boolean;
    readonly onExport: (name: string) => void;
}
export declare function OfflinePluginsRow(props: OfflinePluginsRowProps): import("react").JSX.Element;
export {};
