/** Shared HTTP plumbing for the offline-plugins routes: JSON finishing and
 * the same loopback same-origin guard the Desktop settings routes use. */
import type { IncomingMessage, ServerResponse } from 'node:http';
export declare function finishJson(res: ServerResponse, statusCode: number, value: object, allow?: 'GET' | 'POST'): void;
/**
 * Same guard as the Desktop settings routes: the actual socket and Host stay
 * on the configured loopback origin. A mutating request must carry the exact
 * Origin header; a read-only GET may fall back to same-site fetch metadata
 * plus its same-origin referrer, because browsers commonly omit Origin on
 * same-origin GET requests.
 */
export declare function isSameOriginLoopbackRequest(req: IncomingMessage, expectedOrigin: string, mutating: boolean): boolean;
export declare function readJsonPost(req: IncomingMessage, res: ServerResponse): Promise<unknown>;
