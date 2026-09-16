/** Strict same-origin HTTP handlers for the private Legal-KB bridge API. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LegalKbStatusResponse } from './contract.ts';
export interface LegalKbRouteDeps {
    readonly expectedOrigin: string;
    readonly status: () => LegalKbStatusResponse;
    readonly activate: (code: string) => Promise<LegalKbStatusResponse | {
        error: string;
    }>;
    readonly disconnect: () => Promise<void>;
}
/** Validate a license code and persist it when the service accepts it. */
export declare function handleLegalKbActivateRequest(req: IncomingMessage, res: ServerResponse, deps: LegalKbRouteDeps): Promise<void>;
/** Read the current bridge state for the renderer. */
export declare function handleLegalKbStatusRequest(req: IncomingMessage, res: ServerResponse, deps: LegalKbRouteDeps): Promise<void>;
/** Remove the persisted license code and unload the bridged tools. */
export declare function handleLegalKbDisconnectRequest(req: IncomingMessage, res: ServerResponse, deps: LegalKbRouteDeps): Promise<void>;
