/** Strict same-origin HTTP handlers for the offline-plugins management API. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfflinePluginsExportStartResponse, OfflinePluginsExportProgressResponse, OfflinePluginsImportResponse, OfflinePluginsListResponse } from './contract.ts';
export type OfflinePluginsRouteDeps = {
    readonly expectedOrigin: string;
    readonly list: () => OfflinePluginsListResponse;
    readonly startExport: (packageName: unknown, destinationDir: unknown) => OfflinePluginsExportStartResponse;
    readonly exportProgress: (jobId: string | null) => OfflinePluginsExportProgressResponse;
    readonly importFrom: (sourceDir: unknown) => Promise<OfflinePluginsImportResponse>;
};
/** Handle `GET /_dsh/offline-plugins/list`. */
export declare function handleListRequest(req: IncomingMessage, res: ServerResponse, deps: OfflinePluginsRouteDeps): void;
/** Handle `POST /_dsh/offline-plugins/export` (start a background job). */
export declare function handleExportStartRequest(req: IncomingMessage, res: ServerResponse, deps: OfflinePluginsRouteDeps): void;
/** Handle `GET /_dsh/offline-plugins/export/progress?jobId=...`. */
export declare function handleExportProgressRequest(req: IncomingMessage, res: ServerResponse, deps: OfflinePluginsRouteDeps): void;
/** Handle `POST /_dsh/offline-plugins/import`. */
export declare function handleImportRequest(req: IncomingMessage, res: ServerResponse, deps: OfflinePluginsRouteDeps): void;
