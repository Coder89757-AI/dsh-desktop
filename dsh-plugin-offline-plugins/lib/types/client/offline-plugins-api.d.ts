/** Fetch wrapper for the offline-plugins host routes. */
import { type OfflinePluginsExportResponse, type OfflinePluginsImportResponse, type OfflinePluginsListResponse } from '../offline/contract.ts';
/** Renderer-facing offline plugin manager API. */
export interface OfflinePluginsApi {
    list(): Promise<OfflinePluginsListResponse>;
    exportPlugin(packageName: string, destinationDir: string): Promise<OfflinePluginsExportResponse>;
    importFrom(sourceDir: string): Promise<OfflinePluginsImportResponse>;
    pickDirectory(): Promise<string | null>;
}
export declare function createOfflinePluginsApi(): OfflinePluginsApi;
