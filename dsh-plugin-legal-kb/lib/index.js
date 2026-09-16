import z from "@deepseek-ai/schemastery";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
//#region src/legal-kb/contract.ts
/** Private same-origin Legal-KB API shared with the bundled renderer. */
/** Validate one license code against the configured knowledge-base service. */
const LEGAL_KB_ACTIVATE_PATH = "/api/desktop/legal-kb/activate";
/** Read the current Legal-KB bridge state. */
const LEGAL_KB_STATUS_PATH = "/api/desktop/legal-kb/status";
/** Remove the persisted license code and unload the bridged tools. */
const LEGAL_KB_DISCONNECT_PATH = "/api/desktop/legal-kb/disconnect";
//#endregion
//#region src/legal-kb/route.ts
const MAX_BODY_BYTES = 16 * 1024;
var BodyTooLargeError = class extends Error {};
var InvalidBodyError = class extends Error {};
function finishJson(res, statusCode, value, allow) {
	res.statusCode = statusCode;
	res.setHeader("cache-control", "no-store");
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("x-content-type-options", "nosniff");
	if (allow !== void 0) res.setHeader("allow", allow);
	res.end(JSON.stringify(value));
}
function error(message) {
	return { error: message };
}
function isLoopbackAddress(address) {
	if (address === void 0) return false;
	if (address === "::1" || address === "127.0.0.1") return true;
	if (address.startsWith("::ffff:")) return address.slice(7).startsWith("127.");
	return address.startsWith("127.");
}
function expectedLoopbackOrigin(expectedOrigin) {
	try {
		const url = new URL(expectedOrigin);
		if (url.origin !== expectedOrigin || url.protocol !== "http:" || url.username !== "" || url.password !== "" || url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") return void 0;
		return url;
	} catch {
		return;
	}
}
function exactHeaderOrigin(value) {
	if (value === void 0) return void 0;
	try {
		return new URL(value).origin === value ? value : void 0;
	} catch {
		return;
	}
}
function referrerOrigin(value) {
	if (value === void 0) return void 0;
	try {
		return new URL(value).origin;
	} catch {
		return;
	}
}
/**
* Same guard as the Desktop settings routes: the actual socket and Host stay
* on the configured loopback origin. A mutating request must carry the exact
* Origin header; a read-only GET may fall back to same-site fetch metadata
* plus its same-origin referrer, because browsers commonly omit Origin on
* same-origin GET requests.
*/
function isSameOriginLoopbackRequest(req, expectedOrigin, mutating) {
	const expected = expectedLoopbackOrigin(expectedOrigin);
	if (expected === void 0 || !isLoopbackAddress(req.socket.remoteAddress)) return false;
	if (req.headers.host?.toLowerCase() !== expected.host.toLowerCase()) return false;
	if (exactHeaderOrigin(req.headers.origin) === expected.origin) return req.headers["sec-fetch-site"] === void 0 || req.headers["sec-fetch-site"] === "same-origin";
	if (mutating) return false;
	return req.headers["sec-fetch-site"] === "same-origin" && referrerOrigin(req.headers.referer) === expected.origin;
}
async function readJsonPost(req, res) {
	if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
		finishJson(res, 415, error("expected application/json"));
		throw new InvalidBodyError();
	}
	const declaredLength = req.headers["content-length"];
	if (declaredLength !== void 0 && !/^\d+$/.test(declaredLength)) {
		finishJson(res, 400, error("invalid content length"));
		throw new InvalidBodyError();
	}
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > MAX_BODY_BYTES) {
			finishJson(res, 413, error("request body too large"));
			throw new BodyTooLargeError();
		}
		chunks.push(buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		finishJson(res, 400, error("invalid JSON body"));
		throw new InvalidBodyError();
	}
}
function parseActivateRequest(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const code = value.code;
	if (typeof code !== "string" || code.trim().length === 0 || code.length > 128) return void 0;
	return { code: code.trim() };
}
/** Validate a license code and persist it when the service accepts it. */
async function handleLegalKbActivateRequest(req, res, deps) {
	if (req.method !== "POST") return finishJson(res, 405, error("method not allowed"), "POST");
	if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) return finishJson(res, 403, error("forbidden"));
	let value;
	try {
		value = await readJsonPost(req, res);
	} catch {
		return;
	}
	const request = parseActivateRequest(value);
	if (request === void 0) return finishJson(res, 400, error("invalid activation request"));
	try {
		const outcome = await deps.activate(request.code);
		if ("error" in outcome) return finishJson(res, 403, error(outcome.error));
		return finishJson(res, 200, outcome);
	} catch (cause) {
		return finishJson(res, 502, error(`knowledge-base service unreachable: ${(cause instanceof Error ? cause.message : String(cause)).slice(0, 200)}`));
	}
}
/** Read the current bridge state for the renderer. */
async function handleLegalKbStatusRequest(req, res, deps) {
	if (req.method !== "GET") return finishJson(res, 405, error("method not allowed"), "GET");
	if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, false)) return finishJson(res, 403, error("forbidden"));
	return finishJson(res, 200, deps.status());
}
/** Remove the persisted license code and unload the bridged tools. */
async function handleLegalKbDisconnectRequest(req, res, deps) {
	if (req.method !== "POST") return finishJson(res, 405, error("method not allowed"), "POST");
	if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) return finishJson(res, 403, error("forbidden"));
	try {
		await deps.disconnect();
	} catch {
		return finishJson(res, 409, error("disconnect failed"));
	}
	return finishJson(res, 200, { accepted: true });
}
//#endregion
//#region src/legal-kb/bridge.ts
/** Stable Cordis plugin name. */
const name = "legal-kb-bridge";
/** Services required before the bridge can register routes and settings. */
const inject = [
	"webServer",
	"settings",
	"connection"
];
/** Settings namespace owned by the Legal-KB bridge. */
const LEGAL_KB_SETTINGS_NAMESPACE = "legal-kb";
/** Default lexford API base used for license activation. */
const LEGAL_KB_DEFAULT_API_URL = "http://127.0.0.1:8310";
/** Default lexford MCP HTTP endpoint bridged into the tool registry. */
const LEGAL_KB_DEFAULT_MCP_URL = "http://127.0.0.1:8300/mcp";
/** Stable MCP server namespace for the bridged tool names. */
const LEGAL_KB_SERVER_NAME = "legal-kb";
/** Schema registered with the standard settings service. */
const LegalKbSettingsSchema = z.object({
	apiUrl: z.string().default(LEGAL_KB_DEFAULT_API_URL),
	mcpUrl: z.string().default(LEGAL_KB_DEFAULT_MCP_URL),
	licenseCode: z.string().default("").role("secret")
});
function optionalString(value) {
	return typeof value === "string" ? value : "";
}
function activationIdentity(body) {
	return {
		licenseId: optionalString(body.license_id),
		name: optionalString(body.name),
		org: optionalString(body.org),
		role: optionalString(body.role),
		credits: typeof body.credits === "number" ? body.credits : null,
		expiresAt: typeof body.expires_at === "number" ? body.expires_at : null
	};
}
/**
* Register the Legal-KB bridge: private same-origin activation routes, the
* persisted settings namespace, and one `dsh-mcp-client` generation whose
* Authorization header follows the persisted license code.
* @param ctx - Host context carrying the web server, settings, and connection services.
*/
function apply(ctx) {
	const settings = ctx.settings.register(LEGAL_KB_SETTINGS_NAMESPACE, LegalKbSettingsSchema, { applies: "live" });
	const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`;
	let fiber;
	let identity = null;
	let lastError = null;
	const statusView = () => {
		const value = settings.get();
		return {
			apiUrl: value.apiUrl,
			mcpUrl: value.mcpUrl,
			connected: value.licenseCode.trim() !== "",
			identity,
			lastError
		};
	};
	/** Swap the MCP bridge generation after license or endpoint changes. */
	const remount = () => {
		fiber?.dispose();
		fiber = void 0;
		const value = settings.get();
		const code = value.licenseCode.trim();
		const url = value.mcpUrl.trim();
		if (code === "" || url === "") return;
		try {
			new URL(url);
		} catch {
			lastError = "MCP endpoint URL is invalid";
			ctx.logger.error("legal-kb: MCP endpoint URL is invalid, bridge not mounted");
			return;
		}
		fiber = ctx.plugin(mcpClient, {
			transport: "streamable-http",
			serverName: LEGAL_KB_SERVER_NAME,
			url,
			headers: { Authorization: `Bearer ${code}` },
			toolCallTimeoutMs: 6e4,
			failOnStartupError: false
		});
	};
	const activate = async (code) => {
		const value = settings.get();
		let endpoint;
		try {
			endpoint = new URL("/api/auth/activate", value.apiUrl.trim());
		} catch {
			return { error: "知识库服务地址无效" };
		}
		let response;
		try {
			response = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code }),
				signal: AbortSignal.timeout(1e4)
			});
		} catch (cause) {
			lastError = cause instanceof Error ? cause.message : String(cause);
			return { error: "知识库服务无法访问，请检查服务地址" };
		}
		if (!response.ok) {
			const detail = await response.json().catch(() => void 0);
			const message = typeof detail?.detail === "string" ? detail.detail : `激活失败 (HTTP ${String(response.status)})`;
			lastError = message;
			return { error: message };
		}
		identity = activationIdentity(await response.json().catch(() => ({})));
		lastError = null;
		if (settings.get().licenseCode.trim() !== code) await settings.update({ licenseCode: code });
		return statusView();
	};
	const disconnect = async () => {
		identity = null;
		lastError = null;
		if (settings.get().licenseCode !== "") await settings.update({ licenseCode: "" });
	};
	const deps = {
		expectedOrigin: rendererOrigin,
		status: statusView,
		activate,
		disconnect
	};
	const routes = [
		[LEGAL_KB_ACTIVATE_PATH, handleLegalKbActivateRequest],
		[LEGAL_KB_STATUS_PATH, handleLegalKbStatusRequest],
		[LEGAL_KB_DISCONNECT_PATH, handleLegalKbDisconnectRequest]
	];
	for (const [path, handler] of routes) ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path,
		handler: (req, res) => {
			const rejection = ctx.connection.requestRejection(req);
			if (rejection !== void 0) {
				res.writeHead(rejection);
				res.end(rejection === 401 ? "unauthorized" : "forbidden");
				return;
			}
			return handler(req, res, deps);
		}
	}), `legal-kb: private route ${path}`);
	ctx.effect(() => {
		remount();
		const stopWatching = settings.watch(() => {
			remount();
		});
		return () => {
			stopWatching();
			fiber?.dispose();
			fiber = void 0;
		};
	}, "legal-kb: MCP bridge generation");
}
//#endregion
export { LEGAL_KB_DEFAULT_API_URL, LEGAL_KB_DEFAULT_MCP_URL, LEGAL_KB_SERVER_NAME, LEGAL_KB_SETTINGS_NAMESPACE, LegalKbSettingsSchema, apply, inject, name };

//# sourceMappingURL=index.js.map