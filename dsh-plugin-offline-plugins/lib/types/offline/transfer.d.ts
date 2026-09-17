/** Export and import of Profile plugins as self-contained directories.
 *
 * An export directory carries the plugin package plus its whole transitive
 * dependency closure (dereferenced real directories, deduplicated by package
 * name) and a manifest. Import validates the manifest, copies packages into
 * the active Profile's node_modules, and registers the plugin in
 * `dsh.profile.bundles` atomically. No registry or network is involved. */
import { type OfflinePluginsExportProgressResponse, type OfflinePluginsExportStartResponse, type OfflinePluginsImportResponse } from './contract.ts';
export declare class OfflinePluginTransferError extends Error {
    readonly code: 'invalid-path' | 'immutable' | 'not-installed' | 'conflict' | 'invalid-manifest' | 'io';
    constructor(code: 'invalid-path' | 'immutable' | 'not-installed' | 'conflict' | 'invalid-manifest' | 'io', message: string);
}
/** Start one export job: validates the request, stages the destination, and
 * begins copying in the background. */
export declare function startExportJob(profileDir: string, packageName: unknown, destinationDir: unknown): OfflinePluginsExportStartResponse;
/** Snapshot one export job's progress. */
export declare function exportJobProgress(jobId: unknown): OfflinePluginsExportProgressResponse;
/** Import one export directory into the active Profile. */
export declare function importProfilePlugin(profileDir: string, sourceDir: unknown): Promise<OfflinePluginsImportResponse>;
