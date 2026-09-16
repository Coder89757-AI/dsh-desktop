/** Same-origin browser client for the launcher-owned Legal-KB bridge. */
import type { LegalKbStatusResponse } from '../legal-kb/contract.ts';
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** Browser operations consumed by the Legal-KB sidebar panel. */
export interface LegalKbApi {
    status(): Promise<LegalKbStatusResponse>;
    activate(code: string): Promise<LegalKbStatusResponse>;
    disconnect(): Promise<void>;
}
/** Validate the bounded status projection before it reaches React state. */
export declare function parseLegalKbStatus(value: unknown): LegalKbStatusResponse;
/** Construct the default same-origin API, with a fetch seam for focused tests. */
export declare function createLegalKbApi(fetcher?: FetchLike): LegalKbApi;
export {};
