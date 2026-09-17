/** Export and import of Profile plugins as self-contained directories.
 *
 * An export directory carries the plugin package plus its whole transitive
 * dependency closure (dereferenced real directories, deduplicated by package
 * name) and a manifest. Import validates the manifest, copies packages into
 * the active Profile's node_modules, and registers the plugin in
 * `dsh.profile.bundles` atomically. No registry or network is involved. */
import { type OfflinePluginsExportResponse, type OfflinePluginsImportResponse } from './contract.ts';
export declare class OfflinePluginTransferError extends Error {
    readonly code: 'invalid-path' | 'immutable' | 'not-installed' | 'conflict' | 'invalid-manifest' | 'io';
    constructor(code: 'invalid-path' | 'immutable' | 'not-installed' | 'conflict' | 'invalid-manifest' | 'io', message: string);
}
/** Export one Profile plugin and its dependency closure to a fresh directory. */
export declare function exportProfilePlugin(profileDir: string, packageName: unknown, destinationDir: unknown): OfflinePluginsExportResponse;
/** Import one export directory into the active Profile. */
export declare function importProfilePlugin(profileDir: string, sourceDir: unknown): Promise<OfflinePluginsImportResponse>;
