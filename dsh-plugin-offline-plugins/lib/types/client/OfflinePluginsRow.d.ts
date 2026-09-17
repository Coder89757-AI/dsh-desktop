/** One installed plugin row with its export action. */
import type { OfflinePluginEntry } from '../offline/contract.ts';
import type { OfflinePluginsLocaleKey } from './offline-plugins-locales.ts';
interface OfflinePluginsRowProps {
    readonly entry: OfflinePluginEntry;
    readonly t: (key: OfflinePluginsLocaleKey) => string;
    readonly busy: boolean;
    readonly onExport: (name: string) => void;
}
export declare function OfflinePluginsRow(props: OfflinePluginsRowProps): import("react").JSX.Element;
export {};
