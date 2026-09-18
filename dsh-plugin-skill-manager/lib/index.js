import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { homedir } from "node:os";
import { parse } from "yaml";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
//#region src/host/mcp-store.ts
/** MCP server configuration store and runtime loader.
*
* Server entries live in a manager-owned JSON file inside the desktop
* profile (the profile's cordis.yml is rewritten by the launcher on every
* boot, so it cannot carry user MCP entries). Enabled entries are loaded at
* runtime as `@deepseek-ai/dsh-mcp-client` plugin instances through
* `ctx.plugin()`, which makes add/remove/toggle take effect immediately —
* no restart required. */
const STORE_VERSION = 1;
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
var McpStoreError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "McpStoreError";
	}
};
function validateServerEntry(entry) {
	if (entry === null || typeof entry !== "object") throw new McpStoreError("server entry must be an object");
	const value = entry;
	const serverName = value.serverName;
	if (typeof serverName !== "string" || !SERVER_NAME_PATTERN.test(serverName)) throw new McpStoreError("serverName must match [A-Za-z0-9_-]{1,32}");
	const enabled = value.enabled === true;
	const stringRecord = (input, label) => {
		if (input === void 0) return {};
		if (input === null || typeof input !== "object" || Array.isArray(input)) throw new McpStoreError(`${label} must be an object of strings`);
		const result = {};
		for (const [key, item] of Object.entries(input)) {
			if (typeof item !== "string") throw new McpStoreError(`${label} values must be strings`);
			result[key] = item;
		}
		return result;
	};
	if (value.transport === "stdio") {
		const command = value.command;
		if (typeof command !== "string" || command.length === 0) throw new McpStoreError("stdio transport requires a command");
		const args = value.args;
		if (args !== void 0 && (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))) throw new McpStoreError("args must be an array of strings");
		const cwd = value.cwd;
		if (cwd !== void 0 && typeof cwd !== "string") throw new McpStoreError("cwd must be a string");
		return {
			serverName,
			transport: "stdio",
			enabled,
			command,
			...args !== void 0 ? { args } : {},
			env: stringRecord(value.env, "env"),
			...cwd !== void 0 && cwd.length > 0 ? { cwd } : {}
		};
	}
	if (value.transport === "streamable-http") {
		const url = value.url;
		if (typeof url !== "string" || !/^https?:\/\//u.test(url)) throw new McpStoreError("streamable-http transport requires an http(s) url");
		return {
			serverName,
			transport: "streamable-http",
			enabled,
			url,
			headers: stringRecord(value.headers, "headers")
		};
	}
	throw new McpStoreError("transport must be \"stdio\" or \"streamable-http\"");
}
/**
* Read one server's tools off the shared registry.
*
* Public names are derived as `mcp__<serverName>__<rawName>`, so the namespace
* prefix is stripped back off for display. A name that lossy normalization
* rewrote keeps its hash suffix: the raw name is not recoverable from the
* public one, and inventing one would be worse than showing the hash.
*/
function collectServerTools(ctx, serverName) {
	const tools = ctx.get("tools");
	if (tools === void 0) return [];
	const prefix = `mcp__${serverName}__`;
	return tools.schemas().filter((schema) => schema.name.startsWith(prefix)).map((schema) => ({
		name: schema.name.slice(prefix.length),
		description: schema.description
	})).sort((left, right) => left.name.localeCompare(right.name));
}
function toClientConfig(entry) {
	if (entry.transport === "stdio") return {
		transport: "stdio",
		serverName: entry.serverName,
		command: entry.command ?? "",
		args: [...entry.args ?? []],
		env: { ...entry.env ?? {} },
		cwd: entry.cwd ?? "",
		toolCallTimeoutMs: 6e4,
		failOnStartupError: false
	};
	return {
		transport: "streamable-http",
		serverName: entry.serverName,
		url: entry.url ?? "",
		headers: { ...entry.headers ?? {} },
		toolCallTimeoutMs: 6e4,
		failOnStartupError: false
	};
}
/** Persistent MCP server list plus live mcp-client instances. */
var McpStore = class {
	ctx;
	path;
	fibers = /* @__PURE__ */ new Map();
	servers = [];
	constructor(ctx, profileDir) {
		this.ctx = ctx;
		this.path = join(profileDir, "mcp-servers.json");
	}
	async initialize() {
		this.servers = this.read();
		for (const entry of this.servers) if (entry.enabled) await this.startOne(entry);
	}
	async dispose() {
		for (const fiber of this.fibers.values()) await fiber.dispose().catch(() => {});
		this.fibers.clear();
	}
	list() {
		return this.servers.map((entry) => ({ ...entry }));
	}
	async save(entryInput) {
		const entry = validateServerEntry(entryInput);
		if (this.servers.some((existing) => existing.serverName === entry.serverName && existing.transport !== entry.transport)) await this.stopOne(entry.serverName);
		const next = this.servers.filter((existing) => existing.serverName !== entry.serverName);
		next.push(entry);
		await this.persist(next);
		await this.stopOne(entry.serverName);
		if (entry.enabled) await this.startOne(entry);
		return { ...entry };
	}
	async remove(serverName) {
		const next = this.servers.filter((existing) => existing.serverName !== serverName);
		if (next.length === this.servers.length) throw new McpStoreError(`${serverName} is not configured`);
		await this.persist(next);
		await this.stopOne(serverName);
	}
	async toggle(serverName, enabled) {
		const entry = this.servers.find((existing) => existing.serverName === serverName);
		if (entry === void 0) throw new McpStoreError(`${serverName} is not configured`);
		const next = this.servers.map((existing) => existing.serverName === serverName ? {
			...existing,
			enabled
		} : existing);
		await this.persist(next);
		await this.stopOne(serverName);
		if (enabled) await this.startOne(entry);
	}
	/** Probe one entry with a real MCP handshake: a temporary mcp-client
	* instance configured with `failOnStartupError: true`, awaited with a
	* timeout, then disposed. The probe uses a derived serverName so it never
	* collides with a live instance of the same server. */
	async test(entryInput, timeoutMs = 2e4) {
		try {
			const entry = validateServerEntry(entryInput);
			const outcome = await this.withProbe(entry, timeoutMs, () => void 0);
			return outcome.ok ? {
				ok: true,
				detail: "connected: MCP handshake and tool synchronization succeeded"
			} : {
				ok: false,
				detail: outcome.detail
			};
		} catch (cause) {
			return {
				ok: false,
				detail: cause instanceof Error ? cause.message : String(cause)
			};
		}
	}
	/**
	* List the tools one entry publishes.
	*
	* A server that is already running answers from the shared registry — those
	* are the tools the model can call right now — while anything else (saved but
	* disabled, or still being edited) gets a temporary probe. `forceProbe` skips
	* the running instance so a caller can ask what the entry in hand would
	* publish, rather than what the live one currently does.
	*/
	async listTools(entryInput, forceProbe = false, timeoutMs = 2e4) {
		try {
			const entry = validateServerEntry(entryInput);
			if (!forceProbe) {
				const running = this.runningTools(entry.serverName);
				if (running !== void 0) return {
					ok: true,
					detail: "read from the running server",
					source: "running",
					tools: running
				};
			}
			const outcome = await this.withProbe(entry, timeoutMs, (probeName) => collectServerTools(this.ctx, probeName));
			return outcome.ok ? {
				ok: true,
				detail: "read from a temporary probe",
				source: "probe",
				tools: outcome.value
			} : {
				ok: false,
				detail: outcome.detail,
				tools: []
			};
		} catch (cause) {
			return {
				ok: false,
				detail: cause instanceof Error ? cause.message : String(cause),
				tools: []
			};
		}
	}
	/**
	* Load one temporary mcp-client instance for `entry`, run `read` against it
	* while it is live, then tear it down.
	*
	* A timed-out probe may never settle, so its disposal is scheduled without
	* blocking the response on the fiber promise.
	*/
	async withProbe(entry, timeoutMs, read) {
		let fiber;
		const probeName = `${entry.serverName.slice(0, 24)}_t${Math.random().toString(36).slice(2, 6)}`;
		try {
			const probe = {
				...toClientConfig(entry),
				serverName: probeName,
				failOnStartupError: true
			};
			const loaded = Promise.resolve(this.ctx.plugin(mcpClient, probe));
			if (await Promise.race([loaded.then(() => "loaded"), new Promise((resolve) => {
				setTimeout(() => {
					resolve("timeout");
				}, timeoutMs);
			})]) === "timeout") {
				fiber = { dispose: async () => {
					loaded.then((instance) => {
						Promise.resolve(instance).then((f) => f.dispose()).catch(() => {});
					}, () => {});
				} };
				return {
					ok: false,
					detail: `connection did not complete within ${String(Math.round(timeoutMs / 1e3))}s`
				};
			}
			fiber = { dispose: async () => {
				await (await loaded).dispose();
			} };
			return {
				ok: true,
				value: read(probeName)
			};
		} catch (cause) {
			return {
				ok: false,
				detail: cause instanceof Error ? cause.message : String(cause)
			};
		} finally {
			await fiber?.dispose().catch(() => {});
		}
	}
	/** Tools a running instance publishes, or `undefined` when none is live. */
	runningTools(serverName) {
		if (!this.fibers.has(serverName)) return void 0;
		return collectServerTools(this.ctx, serverName);
	}
	read() {
		if (!existsSync(this.path)) return [];
		let document;
		try {
			document = JSON.parse(readFileSync(this.path, "utf8"));
		} catch {
			this.ctx.logger.warn("skill-manager: mcp-servers.json is unreadable; starting with no servers");
			return [];
		}
		const servers = document?.servers;
		if (!Array.isArray(servers)) return [];
		const result = [];
		for (const entry of servers) try {
			result.push(validateServerEntry(entry));
		} catch (cause) {
			this.ctx.logger.warn(`skill-manager: dropping invalid MCP entry: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
		return result;
	}
	async persist(next) {
		const document = {
			version: STORE_VERSION,
			servers: next.map((entry) => ({ ...entry }))
		};
		await writeFileAtomic(this.path, `${JSON.stringify(document, void 0, 2)}\n`, { mode: 384 });
		this.servers = next;
	}
	async startOne(entry) {
		if (this.fibers.has(entry.serverName)) return;
		try {
			const fiber = this.ctx.plugin(mcpClient, toClientConfig(entry));
			await Promise.resolve(fiber);
			this.fibers.set(entry.serverName, fiber);
		} catch (cause) {
			this.ctx.logger.warn(`skill-manager: MCP server ${entry.serverName} failed to start: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
	}
	async stopOne(serverName) {
		const fiber = this.fibers.get(serverName);
		if (fiber === void 0) return;
		this.fibers.delete(serverName);
		await fiber.dispose().catch(() => {});
	}
};
//#endregion
//#region src/host/skills-store.ts
/** Skill inventory and lifecycle over the same filesystem layout the upstream
* skill-filesystem provider discovers.
*
* Scopes: `system` skills ship with the application (bundled root), `user`
* skills live under `$DSH_HOME/skills` and `$DSH_AGENTS_HOME/skills`.
*
* Enable/disable uses a `.disabled` shadow directory per root: discovery only
* scans the top level of each root, so entries moved one level deeper become
* invisible to the provider, and the chokidar watcher refreshes the catalog
* live. Bundled skills are application-owned and cannot be moved; disabling
* one instead writes a same-named inert "shadow" user skill — user roots
* outrank the bundled root in the registry's duplicate arbitration, and the
* shadow's frontmatter turns off both model and user invocation. */
const SHADOW_DIR = ".disabled";
const SYSTEM_DIR = ".system";
const SHADOW_MARKER = "dsh-skill-manager-shadow";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const MAX_SKILL_BYTES = 1024 * 1024;
var SkillsStoreError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "SkillsStoreError";
	}
};
/** Filesystem-backed skill inventory and lifecycle operations. */
var SkillsStore = class {
	userDshRoot;
	userAgentsRoot;
	bundledRoot;
	constructor() {
		this.userDshRoot = join(resolveDshHome(), "skills");
		this.userAgentsRoot = resolve(process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents"), "skills");
		const bundled = process.env.DSH_BUNDLED_SKILL_DIR;
		this.bundledRoot = bundled === void 0 || bundled.length === 0 ? void 0 : resolve(bundled);
	}
	/** Roots to expose in the panel. Bundled first so system skills read top-down. */
	roots() {
		const roots = [];
		if (this.bundledRoot !== void 0) roots.push({
			path: this.bundledRoot,
			scope: "system",
			skipSystem: false
		});
		roots.push({
			path: this.userDshRoot,
			scope: "user",
			skipSystem: true
		});
		roots.push({
			path: this.userAgentsRoot,
			scope: "user",
			skipSystem: false
		});
		return roots;
	}
	list() {
		const entries = [];
		for (const root of this.roots()) entries.push(...this.discoverRoot(root, false), ...this.discoverRoot(root, true));
		const shadows = new Set(entries.filter((entry) => entry.scope === "user" && this.isShadow(entry)).map((entry) => entry.name));
		return entries.filter((entry) => !(entry.scope === "user" && this.isShadow(entry))).map((entry) => entry.scope === "system" && shadows.has(entry.name) ? {
			...entry,
			enabled: false
		} : entry);
	}
	async toggle(name, scope, enabled) {
		if (scope === "system") {
			this.toggleSystem(name, enabled);
			return;
		}
		const entry = this.list().find((item) => item.name === name && item.scope === "user");
		if (entry === void 0) throw new SkillsStoreError(`user skill ${name} is not installed`);
		if (entry.enabled === enabled) return;
		const root = this.containingRoot(entry.path);
		if (root === void 0) throw new SkillsStoreError(`skill ${name} is outside the managed skill roots`);
		if (enabled) this.moveWithinRoot(join(root, SHADOW_DIR, this.leafName(entry)), join(root, this.leafName(entry)));
		else {
			const shadowRoot = join(root, SHADOW_DIR);
			mkdirSync(shadowRoot, { recursive: true });
			this.moveWithinRoot(join(root, this.leafName(entry)), join(shadowRoot, this.leafName(entry)));
		}
	}
	async save(name, content) {
		if (!SKILL_NAME_PATTERN.test(name)) throw new SkillsStoreError("skill name must be lowercase letters, digits, and hyphens");
		if (content.length > MAX_SKILL_BYTES) throw new SkillsStoreError("skill content exceeds the supported size");
		const parsed = parseSkillFileContent(content);
		if (parsed === void 0) throw new SkillsStoreError("content must start with YAML frontmatter delimiters (---)");
		if (parsed.name !== name) throw new SkillsStoreError(`frontmatter name "${parsed.name}" does not match "${name}"`);
		if (parsed.description.length === 0) throw new SkillsStoreError("frontmatter requires a description");
		const target = join(this.userDshRoot, name);
		if (!existsSync(target) && existsSync(join(this.userDshRoot, SHADOW_DIR, name))) this.moveWithinRoot(join(this.userDshRoot, SHADOW_DIR, name), target);
		mkdirSync(target, { recursive: true });
		writeFileSync(join(target, "SKILL.md"), content.endsWith("\n") ? content : `${content}\n`, { mode: 384 });
	}
	async remove(name) {
		const entry = this.list().find((item) => item.name === name && item.scope === "user");
		if (entry === void 0) throw new SkillsStoreError(`user skill ${name} is not installed`);
		const root = this.containingRoot(entry.path);
		if (root === void 0) throw new SkillsStoreError(`skill ${name} is outside the managed skill roots`);
		const target = entry.enabled ? join(root, this.leafName(entry)) : join(root, SHADOW_DIR, this.leafName(entry));
		rmSync(this.assertUnderRoot(target, root), {
			recursive: true,
			force: true
		});
	}
	async importFrom(sourceDir) {
		const source = resolve(sourceDir);
		let entries;
		try {
			entries = readdirSync(source, { withFileTypes: true });
		} catch {
			throw new SkillsStoreError(`cannot read directory ${source}`);
		}
		const existing = new Set(this.list().map((entry) => entry.name));
		const imported = [];
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const from = join(source, entry.name);
			if (entry.isDirectory()) {
				if (!existsSync(join(from, "SKILL.md"))) continue;
				const parsed = parseSkillFile(join(from, "SKILL.md"));
				if (parsed === void 0) continue;
				if (existing.has(parsed.name)) throw new SkillsStoreError(`a skill named ${parsed.name} already exists`);
				cpSync(from, join(this.userDshRoot, entry.name), {
					recursive: true,
					dereference: true
				});
				existing.add(parsed.name);
				imported.push(parsed.name);
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				const parsed = parseSkillFile(from);
				if (parsed === void 0) continue;
				if (existing.has(parsed.name)) throw new SkillsStoreError(`a skill named ${parsed.name} already exists`);
				cpSync(from, join(this.userDshRoot, entry.name), { dereference: true });
				existing.add(parsed.name);
				imported.push(parsed.name);
			}
		}
		if (imported.length === 0) throw new SkillsStoreError("no skill files found under the chosen directory");
		return imported;
	}
	read(name, scope) {
		const entry = this.list().find((item) => item.name === name && item.scope === scope);
		if (entry === void 0) throw new SkillsStoreError(`skill ${name} (${scope}) is not installed`);
		let content;
		try {
			content = readFileSync(entry.path, "utf8");
		} catch {
			throw new SkillsStoreError(`skill file ${entry.path} is not readable`);
		}
		if (content.length > MAX_SKILL_BYTES) throw new SkillsStoreError("skill content exceeds the supported size");
		return {
			content,
			readOnly: scope === "system"
		};
	}
	toggleSystem(name, enabled) {
		const shadowDir = join(this.userDshRoot, name);
		if (!enabled) {
			if (existsSync(shadowDir)) {
				if (!this.isShadowPath(shadowDir)) throw new SkillsStoreError(`a user skill named ${name} already exists; remove it to disable the system skill`);
				return;
			}
			mkdirSync(shadowDir, { recursive: true });
			writeFileSync(join(shadowDir, "SKILL.md"), [
				"---",
				`name: ${name}`,
				"description: inert shadow disabling a bundled skill",
				"disable-model-invocation: true",
				"user-invocable: false",
				"metadata:",
				`  ${SHADOW_MARKER}: true`,
				"---",
				""
			].join("\n"), { mode: 384 });
			return;
		}
		if (!existsSync(shadowDir)) return;
		if (!this.isShadowPath(shadowDir)) throw new SkillsStoreError(`${name} is a real user skill, not a disable marker`);
		rmSync(shadowDir, {
			recursive: true,
			force: true
		});
	}
	isShadow(entry) {
		return this.isShadowPath(dirname(entry.path));
	}
	isShadowPath(directory) {
		const skillFile = join(directory, "SKILL.md");
		if (!existsSync(skillFile)) return false;
		return parseSkillFile(skillFile)?.shadow === true;
	}
	leafName(entry) {
		return entry.kind === "directory" ? basename(dirname(entry.path)) : basename(entry.path);
	}
	containingRoot(entryPath) {
		return this.roots().map((root) => root.path).find((root) => this.isUnder(entryPath, root) || this.isUnder(entryPath, join(root, SHADOW_DIR)));
	}
	assertUnderRoot(path, root) {
		if (!this.isUnder(path, root)) throw new SkillsStoreError("path escaped the skill root");
		return path;
	}
	isUnder(path, root) {
		const relative = resolve(path).slice(resolve(root).length);
		return relative.startsWith("/") || relative.startsWith("\\");
	}
	moveWithinRoot(from, to) {
		if (!existsSync(from)) throw new SkillsStoreError(`expected skill entry is missing: ${from}`);
		if (existsSync(to)) throw new SkillsStoreError(`target already exists: ${to}`);
		mkdirSync(dirname(to), { recursive: true });
		renameSync(from, to);
	}
	discoverRoot(root, disabled) {
		const base = disabled ? join(root.path, SHADOW_DIR) : root.path;
		let entries;
		try {
			entries = readdirSync(base, { withFileTypes: true });
		} catch {
			return [];
		}
		const result = [];
		for (const entry of entries) {
			if (entry.name === SYSTEM_DIR && root.skipSystem && !disabled) continue;
			if (entry.name === SHADOW_DIR) continue;
			const path = join(base, entry.name);
			let skillPath;
			let kind;
			if (entry.isDirectory()) {
				skillPath = join(path, "SKILL.md");
				kind = "directory";
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				skillPath = path;
				kind = "flat";
			}
			if (skillPath === void 0 || kind === void 0 || !existsSync(skillPath)) continue;
			const parsed = parseSkillFile(skillPath);
			if (parsed === void 0) continue;
			result.push({
				name: parsed.name,
				description: parsed.description,
				scope: root.scope,
				enabled: !disabled,
				kind,
				path: skillPath
			});
		}
		return result;
	}
};
function parseSkillFile(path) {
	try {
		return parseSkillFileContent(readFileSync(path, "utf8"));
	} catch {
		return;
	}
}
/** Minimal frontmatter reader aligned with the upstream provider's rules:
* a leading `---` block with string `name` and `description`. */
function parseSkillFileContent(raw) {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/u, "") !== "---") return void 0;
	let cursor = firstLineEnd + 1;
	for (;;) {
		const nextNewline = raw.indexOf("\n", cursor);
		const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
		if (raw.slice(cursor, lineEnd).replace(/\r$/u, "") === "---") {
			let data;
			try {
				data = parse(raw.slice(firstLineEnd + 1, cursor));
			} catch {
				return;
			}
			if (typeof data !== "object" || data === null || Array.isArray(data)) return void 0;
			const document = data;
			const name = document.name;
			const description = document.description;
			if (typeof name !== "string" || name.length === 0 || typeof description !== "string") return void 0;
			if (!SKILL_NAME_PATTERN.test(name)) return void 0;
			const metadata = document.metadata;
			return {
				name,
				description,
				shadow: typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) && metadata[SHADOW_MARKER] === true
			};
		}
		if (nextNewline < 0) return void 0;
		cursor = nextNewline + 1;
	}
}
//#endregion
//#region src/host/contract.ts
/** Shared contract between the skill-manager Host routes and client panel. */
/** Same-origin route returning the full management state. */
const SKILL_MANAGER_STATE_PATH = "/_dsh/skill-manager/state";
/** Same-origin route persisting one MCP server entry. */
const SKILL_MANAGER_MCP_SAVE_PATH = "/_dsh/skill-manager/mcp/save";
/** Same-origin route removing one MCP server entry. */
const SKILL_MANAGER_MCP_REMOVE_PATH = "/_dsh/skill-manager/mcp/remove";
/** Same-origin route enabling or disabling one MCP server. */
const SKILL_MANAGER_MCP_TOGGLE_PATH = "/_dsh/skill-manager/mcp/toggle";
/** Same-origin route probing one MCP server entry with a live connection. */
const SKILL_MANAGER_MCP_TEST_PATH = "/_dsh/skill-manager/mcp/test";
/** Same-origin route listing the tools one MCP server entry publishes. */
const SKILL_MANAGER_MCP_TOOLS_PATH = "/_dsh/skill-manager/mcp/tools";
/** Same-origin route enabling or disabling one skill. */
const SKILL_MANAGER_SKILL_TOGGLE_PATH = "/_dsh/skill-manager/skills/toggle";
/** Same-origin route saving (creating or updating) a user skill. */
const SKILL_MANAGER_SKILL_SAVE_PATH = "/_dsh/skill-manager/skills/save";
/** Same-origin route deleting a user skill. */
const SKILL_MANAGER_SKILL_DELETE_PATH = "/_dsh/skill-manager/skills/delete";
/** Same-origin route importing skills from a picked directory. */
const SKILL_MANAGER_SKILL_IMPORT_PATH = "/_dsh/skill-manager/skills/import";
/** Same-origin route reading one skill's full SKILL.md content. */
const SKILL_MANAGER_SKILL_READ_PATH = "/_dsh/skill-manager/skills/read";
//#endregion
//#region src/host/http.ts
const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
function finishJson(res, statusCode, value, allow) {
	res.statusCode = statusCode;
	res.setHeader("cache-control", "no-store");
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("x-content-type-options", "nosniff");
	if (allow !== void 0) res.setHeader("allow", allow);
	res.end(JSON.stringify(value));
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
async function readJsonPost(req, res, maxBodyBytes = DEFAULT_MAX_BODY_BYTES) {
	if (req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
		finishJson(res, 415, { error: "expected application/json" });
		throw new Error("invalid content type");
	}
	const declaredLength = req.headers["content-length"];
	if (declaredLength !== void 0 && !/^\d+$/.test(declaredLength)) {
		finishJson(res, 400, { error: "invalid content length" });
		throw new Error("invalid content length");
	}
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > maxBodyBytes) {
			finishJson(res, 413, { error: "request body too large" });
			throw new Error("request body too large");
		}
		chunks.push(buffer);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		finishJson(res, 400, { error: "invalid JSON body" });
		throw new Error("invalid JSON body");
	}
}
//#endregion
//#region src/host/route.ts
/** Skill bodies can be large; ordinary mutation bodies stay small. */
const MAX_SKILL_BODY_BYTES = 512 * 1024;
function error(message) {
	return { error: message };
}
function guard(req, res, deps, mutating) {
	if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, mutating)) {
		finishJson(res, 403, error("same-origin request required"));
		return false;
	}
	return true;
}
function fail(res, cause, conflict) {
	const message = cause instanceof Error ? cause.message : String(cause);
	finishJson(res, cause instanceof McpStoreError || cause instanceof SkillsStoreError ? conflict ? 409 : 400 : 500, error(message));
}
function stringField(body, key) {
	const value = body[key];
	return typeof value === "string" ? value : void 0;
}
function scopeField(body) {
	const value = body.scope;
	return value === "system" || value === "user" ? value : void 0;
}
/** Handle `GET /_dsh/skill-manager/state`. */
function handleStateRequest(req, res, deps) {
	if (req.method !== "GET") {
		finishJson(res, 405, error("GET only"), "GET");
		return;
	}
	if (!guard(req, res, deps, false)) return;
	try {
		finishJson(res, 200, {
			mcpServers: deps.mcpStore.list(),
			skills: deps.skillsStore.list()
		});
	} catch (cause) {
		fail(res, cause, false);
	}
}
/** Handle `GET /_dsh/skill-manager/skills/read?name=...&scope=...`. */
function handleSkillReadRequest(req, res, deps) {
	if (req.method !== "GET") {
		finishJson(res, 405, error("GET only"), "GET");
		return;
	}
	if (!guard(req, res, deps, false)) return;
	const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
	const name = params.get("name");
	const scope = params.get("scope");
	if (name === null || scope !== "system" && scope !== "user") {
		finishJson(res, 400, error("name and scope (system|user) query parameters are required"));
		return;
	}
	try {
		finishJson(res, 200, deps.skillsStore.read(name, scope));
	} catch (cause) {
		fail(res, cause, false);
	}
}
/** Handle `POST /_dsh/skill-manager/mcp/save`. */
const handleMcpSaveRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		if (!("server" in body)) {
			finishJson(res, 400, error("server is required"));
			return;
		}
		try {
			finishJson(res, 200, { server: await deps.mcpStore.save(body.server) });
		} catch (cause) {
			fail(res, cause, false);
		}
	})().catch(() => {});
};
const handleMcpRemoveRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		const serverName = stringField(body, "serverName");
		if (serverName === void 0) {
			finishJson(res, 400, error("serverName is required"));
			return;
		}
		try {
			await deps.mcpStore.remove(serverName);
			finishJson(res, 200, { removed: serverName });
		} catch (cause) {
			fail(res, cause, true);
		}
	})().catch(() => {});
};
const handleMcpToggleRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		const serverName = stringField(body, "serverName");
		if (serverName === void 0 || typeof body.enabled !== "boolean") {
			finishJson(res, 400, error("serverName and enabled are required"));
			return;
		}
		try {
			await deps.mcpStore.toggle(serverName, body.enabled);
			finishJson(res, 200, { toggled: serverName });
		} catch (cause) {
			fail(res, cause, true);
		}
	})().catch(() => {});
};
/** Handle `POST /_dsh/skill-manager/mcp/test` (long-running probe). */
const handleMcpTestRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res, 256 * 1024).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		if (!("server" in body)) {
			finishJson(res, 400, error("server is required"));
			return;
		}
		finishJson(res, 200, await deps.mcpStore.test(body.server));
	})().catch(() => {});
};
/** Handle `POST /_dsh/skill-manager/mcp/tools` (long-running probe). */
const handleMcpToolsRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res, 256 * 1024).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		if (!("server" in body)) {
			finishJson(res, 400, error("server is required"));
			return;
		}
		finishJson(res, 200, await deps.mcpStore.listTools(body.server, body.probe === true));
	})().catch(() => {});
};
const handleSkillToggleRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		const name = stringField(body, "name");
		const scope = scopeField(body);
		if (name === void 0 || scope === void 0 || typeof body.enabled !== "boolean") {
			finishJson(res, 400, error("name, scope, and enabled are required"));
			return;
		}
		try {
			await deps.skillsStore.toggle(name, scope, body.enabled);
			finishJson(res, 200, { toggled: name });
		} catch (cause) {
			fail(res, cause, true);
		}
	})().catch(() => {});
};
const handleSkillSaveRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res, MAX_SKILL_BODY_BYTES).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		const name = stringField(body, "name");
		const content = stringField(body, "content");
		if (name === void 0 || content === void 0) {
			finishJson(res, 400, error("name and content are required"));
			return;
		}
		try {
			await deps.skillsStore.save(name, content);
			finishJson(res, 200, { saved: name });
		} catch (cause) {
			fail(res, cause, false);
		}
	})().catch(() => {});
};
const handleSkillDeleteRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		const name = stringField(body, "name");
		if (name === void 0) {
			finishJson(res, 400, error("name is required"));
			return;
		}
		try {
			await deps.skillsStore.remove(name);
			finishJson(res, 200, { deleted: name });
		} catch (cause) {
			fail(res, cause, true);
		}
	})().catch(() => {});
};
const handleSkillImportRequest = (req, res, deps) => {
	(async () => {
		if (req.method !== "POST" || !guard(req, res, deps, true)) {
			if (res.writableEnded) return;
			if (req.method !== "POST") finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		const body = await readJsonPost(req, res).then((value) => value).catch(() => void 0);
		if (body === void 0) return;
		const sourceDir = stringField(body, "sourceDir");
		if (sourceDir === void 0) {
			finishJson(res, 400, error("sourceDir is required"));
			return;
		}
		try {
			finishJson(res, 200, { imported: await deps.skillsStore.importFrom(sourceDir) });
		} catch (cause) {
			fail(res, cause, true);
		}
	})().catch(() => {});
};
//#endregion
//#region src/host/bridge.ts
/** Stable Cordis plugin name. */
const name = "skill-manager-bridge";
/** Services resolved before routes register. */
const inject = [
	"webServer",
	"connection",
	"desktopPnpmBootstrap"
];
/** Register the bridge: management routes over the shared web server. */
function apply(ctx) {
	const profileDir = ctx.desktopPnpmBootstrap.activeProfileDir;
	const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`;
	const mcpStore = new McpStore(ctx, profileDir);
	const deps = {
		expectedOrigin: rendererOrigin,
		mcpStore,
		skillsStore: new SkillsStore()
	};
	const routes = [
		[SKILL_MANAGER_STATE_PATH, handleStateRequest],
		[SKILL_MANAGER_MCP_SAVE_PATH, handleMcpSaveRequest],
		[SKILL_MANAGER_MCP_REMOVE_PATH, handleMcpRemoveRequest],
		[SKILL_MANAGER_MCP_TOGGLE_PATH, handleMcpToggleRequest],
		[SKILL_MANAGER_MCP_TEST_PATH, handleMcpTestRequest],
		[SKILL_MANAGER_MCP_TOOLS_PATH, handleMcpToolsRequest],
		[SKILL_MANAGER_SKILL_TOGGLE_PATH, handleSkillToggleRequest],
		[SKILL_MANAGER_SKILL_SAVE_PATH, handleSkillSaveRequest],
		[SKILL_MANAGER_SKILL_DELETE_PATH, handleSkillDeleteRequest],
		[SKILL_MANAGER_SKILL_IMPORT_PATH, handleSkillImportRequest],
		[SKILL_MANAGER_SKILL_READ_PATH, handleSkillReadRequest]
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
	}), `skill-manager: private route ${path}`);
	ctx.effect(function* () {
		yield async () => {
			await mcpStore.dispose();
		};
	}, "skill-manager: mcp runtime disposal");
	mcpStore.initialize();
}
//#endregion
export { McpStore, McpStoreError, SkillsStore, SkillsStoreError, apply, inject, name };

//# sourceMappingURL=index.js.map