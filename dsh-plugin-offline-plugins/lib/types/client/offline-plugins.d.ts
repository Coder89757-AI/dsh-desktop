/** Offline-plugins sidebar entry registration for the Desktop client bundle. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type OfflinePluginsLocaleKey } from './offline-plugins-locales.ts';
/** Locale namespace owned by the offline-plugins entry. */
export declare const OFFLINE_PLUGINS_LOCALE_NAMESPACE = "offline-plugins";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Offline-plugins sidebar entry copy. */
        'offline-plugins': OfflinePluginsLocaleKey;
    }
}
/** Register the offline-plugins entry in the sidebar footer action list slot. */
export declare function applyOfflinePlugins(ctx: ClientContext): void;
