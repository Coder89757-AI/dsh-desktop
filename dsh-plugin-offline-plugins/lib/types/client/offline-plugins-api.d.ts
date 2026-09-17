/** Fetch wrapper for the offline-plugins host routes. */
import { type OfflinePluginsExportProgressResponse, type OfflinePluginsExportStartResponse, type OfflinePluginsImportResponse, type OfflinePluginsListResponse } from '../offline/contract.ts';
/** Renderer-facing offline plugin manager API. */
export interface OfflinePluginsApi {
    list(): Promise<OfflinePluginsListResponse>;
    startExport(packageName: string, destinationDir: string): Promise<OfflinePluginsExportStartResponse>;
    exportProgress(jobId: string): Promise<OfflinePluginsExportProgressResponse>;
    importFrom(sourceDir: string): Promise<OfflinePluginsImportResponse>;
    pickDirectory(): Promise<string | null>;
}
export declare function createOfflinePluginsApi(): OfflinePluginsApi;
