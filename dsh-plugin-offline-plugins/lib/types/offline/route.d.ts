/** Strict same-origin HTTP handlers for the offline-plugins management API. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfflinePluginsExportResponse, OfflinePluginsImportResponse, OfflinePluginsListResponse } from './contract.ts';
export type OfflinePluginsRouteDeps = {
    readonly expectedOrigin: string;
    readonly list: () => OfflinePluginsListResponse;
    readonly exportPlugin: (packageName: unknown, destinationDir: unknown) => OfflinePluginsExportResponse;
    readonly importFrom: (sourceDir: unknown) => Promise<OfflinePluginsImportResponse>;
};
/** Handle `GET /_dsh/offline-plugins/list`. */
export declare function handleListRequest(req: IncomingMessage, res: ServerResponse, deps: OfflinePluginsRouteDeps): void;
/** Handle `POST /_dsh/offline-plugins/export`. */
export declare function handleExportRequest(req: IncomingMessage, res: ServerResponse, deps: OfflinePluginsRouteDeps): void;
/** Handle `POST /_dsh/offline-plugins/import`. */
export declare function handleImportRequest(req: IncomingMessage, res: ServerResponse, deps: OfflinePluginsRouteDeps): void;
