import { createRequire } from "node:module";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
//#region src/offline/inventory.ts
/** Profile plugin inventory: manifest bundles resolved against the Profile's
* node_modules, including package versions and the dependency closure used by
* exports. */
/** Bundles that ship with the application itself and are never exportable. */
const IMMUTABLE_BUNDLE_NAMES = /* @__PURE__ */ new Set([
	"@deepseek-ai/dsh-base",
	"@deepseek-ai/dsh-web-app",
	"dsh-community-market",
	"dsh-plugin-desktop",
	"dsh-plugin-desktop-beta"
]);
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
function isValidPackageName(name) {
	return name.length <= 214 && PACKAGE_NAME_PATTERN.test(name);
}
function stringArray(value) {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : [];
}
/** Read the active Profile manifest's declared bundle names. */
function readProfileManifest(profileDir) {
	return { bundles: stringArray(JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8")).dsh?.profile?.bundles) };
}
function readPackageDocument(packageDir) {
	try {
		return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	} catch {
		return;
	}
}
function packageVersion(packageDir) {
	const document = readPackageDocument(packageDir);
	return typeof document?.version === "string" ? document.version : "0.0.0";
}
/** Real on-disk directory for one installed package, following pnpm links. */
function installedPackageDir(profileDir, name) {
	const candidate = join(profileDir, "node_modules", name);
	try {
		const info = lstatSync(candidate);
		if (!info.isDirectory() && !info.isSymbolicLink()) return void 0;
		return realpathSync(candidate);
	} catch {
		return;
	}
}
/** Dependency names a package declares for ordinary installation. */
function declaredDependencies(document) {
	const names = [];
	for (const field of ["dependencies", "optionalDependencies"]) {
		const value = document[field];
		if (value !== null && typeof value === "object" && !Array.isArray(value)) for (const name of Object.keys(value)) names.push(name);
	}
	return names;
}
/** Walk node_modules ancestors manually (handles ESM-only packages whose
* `exports` map blocks `require.resolve`). */
function probeNodeModules(dependencyName, startDir) {
	const segments = dependencyName.split("/");
	let current = resolve(startDir);
	for (;;) {
		const candidate = join(/node_modules[/\\]?$/u.test(current) ? current : join(current, "node_modules"), ...segments);
		if (existsSync(join(candidate, "package.json"))) {
			if (readPackageDocument(candidate)?.name === dependencyName) try {
				return realpathSync(candidate);
			} catch {
				return;
			}
		}
		const parent = dirname(current);
		if (parent === current) return void 0;
		current = parent;
	}
}
/** Resolve one dependency's real package root the way Node would from `fromDir`. */
function resolveDependencyRoot(dependencyName, fromDir) {
	const localRequire = createRequire(join(fromDir, "package.json"));
	for (const subpath of [`${dependencyName}/package.json`, dependencyName]) try {
		let current = resolve(dirname(localRequire.resolve(subpath)));
		for (;;) {
			if (existsSync(join(current, "package.json"))) {
				if (readPackageDocument(current)?.name === dependencyName) return current;
			}
			const parent = dirname(current);
			if (parent === current) return void 0;
			current = parent;
		}
	} catch {}
	return probeNodeModules(dependencyName, fromDir);
}
/** Depth-first dependency closure of one installed package, keyed by name. */
function dependencyClosure(profileDir, rootName) {
	const packages = /* @__PURE__ */ new Map();
	const unresolved = /* @__PURE__ */ new Set();
	const visit = (name, fromDir) => {
		const root = resolveDependencyRoot(name, fromDir) ?? resolveDependencyRoot(name, profileDir);
		if (root === void 0) {
			unresolved.add(name);
			return;
		}
		if (packages.get(name) !== void 0) return;
		packages.set(name, root);
		const document = readPackageDocument(root);
		if (document === void 0) return;
		for (const dependencyName of declaredDependencies(document)) {
			if (dependencyName === name) continue;
			if (!isValidPackageName(dependencyName)) continue;
			visit(dependencyName, root);
		}
	};
	visit(rootName, profileDir);
	packages.delete(rootName);
	return {
		packages,
		unresolved: [...unresolved]
	};
}
/** Every installed Profile plugin visible to the management panel.
* `mutableNames` and `disabledNames` come from the Desktop plugin-management
* service; names it does not know fall back to the launcher-owned set. */
function listInstalledPlugins(profileDir, mutableNames, disabledNames) {
	const manifest = readProfileManifest(profileDir);
	const entries = [];
	for (const name of manifest.bundles) {
		const packageDir = installedPackageDir(profileDir, name);
		const knownMutable = mutableNames.size > 0 ? mutableNames.has(name) : !IMMUTABLE_BUNDLE_NAMES.has(name);
		entries.push({
			name,
			version: packageDir === void 0 ? "?" : packageVersion(packageDir),
			immutable: !knownMutable,
			disabled: disabledNames.has(name)
		});
	}
	return entries;
}
//#endregion
//#region src/offline/contract.ts
/** Shared contract between the offline-plugins Host routes and client panel. */
/** Same-origin route listing installed Profile plugins. */
const OFFLINE_PLUGINS_LIST_PATH = "/_dsh/offline-plugins/list";
/** Same-origin route starting one Profile plugin export job. */
const OFFLINE_PLUGINS_EXPORT_PATH = "/_dsh/offline-plugins/export";
/** Same-origin route polling one export job's progress. */
const OFFLINE_PLUGINS_EXPORT_PROGRESS_PATH = "/_dsh/offline-plugins/export/progress";
/** Same-origin route importing one export directory into the active Profile. */
const OFFLINE_PLUGINS_IMPORT_PATH = "/_dsh/offline-plugins/import";
/** Marker written into every export manifest. */
const EXPORT_MANIFEST_KIND = "dsh-offline-plugins-export";
//#endregion
//#region src/offline/transfer.ts
/** Export and import of Profile plugins as self-contained directories.
*
* An export directory carries the plugin package plus its whole transitive
* dependency closure (dereferenced real directories, deduplicated by package
* name) and a manifest. Import validates the manifest, copies packages into
* the active Profile's node_modules, and registers the plugin in
* `dsh.profile.bundles` atomically. No registry or network is involved. */
/** Finished export jobs are pruned after this long. */
const EXPORT_JOB_TTL_MS = 1800 * 1e3;
const MAX_PATH_BYTES = 32 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_EXPORT_PACKAGES = 1024;
const MAX_PACKAGE_FILES = 1e5;
var OfflinePluginTransferError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "OfflinePluginTransferError";
	}
};
function assertTransferPath(label, value) {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0") || !isAbsolute(value) || Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES) throw new OfflinePluginTransferError("invalid-path", `${label} must be a bounded absolute path`);
	return resolve(value);
}
function assertRealDirectory(label, path) {
	let info;
	try {
		info = lstatSync(path);
	} catch {
		throw new OfflinePluginTransferError("invalid-path", `${label} does not exist: ${path}`);
	}
	if (!info.isDirectory()) throw new OfflinePluginTransferError("invalid-path", `${label} must be a directory: ${path}`);
}
function sanitizedComponent(name) {
	const sanitized = name.replace(/[^A-Za-z0-9._-]/gu, "__");
	return sanitized.length > 0 && sanitized.length <= 128 ? sanitized : "unnamed";
}
function packageVersionOf(packageDir) {
	try {
		const document = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
		return typeof document.version === "string" ? document.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}
function directoryBytes(root) {
	let total = 0;
	let visited = 0;
	const walk = (current) => {
		if (visited > MAX_PACKAGE_FILES) return;
		let entries;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			visited += 1;
			const child = join(current, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) walk(child);
			else if (entry.isFile()) try {
				total += statSync(child).size;
			} catch {}
		}
	};
	walk(root);
	return total;
}
const exportJobs = /* @__PURE__ */ new Map();
function yieldToEventLoop() {
	return new Promise((resolveEvent) => {
		setImmediate(resolveEvent);
	});
}
function pruneExportJobs(now) {
	for (const [id, job] of exportJobs) if (job.status !== "running" && now - Number(id.slice(4)) > EXPORT_JOB_TTL_MS) exportJobs.delete(id);
}
/** Start one export job: validates the request, stages the destination, and
* begins copying in the background. */
function startExportJob(profileDir, packageName, destinationDir) {
	if (typeof packageName !== "string" || !isValidPackageName(packageName)) throw new OfflinePluginTransferError("invalid-path", "package name is invalid");
	const destination = assertTransferPath("destination directory", destinationDir);
	assertRealDirectory("destination directory", destination);
	if (IMMUTABLE_BUNDLE_NAMES.has(packageName)) throw new OfflinePluginTransferError("immutable", `${packageName} ships with the application and cannot be exported`);
	for (const job of exportJobs.values()) if (job.status === "running") throw new OfflinePluginTransferError("conflict", "an export is already running; wait for it to finish");
	if (!readProfileManifest(profileDir).bundles.includes(packageName)) throw new OfflinePluginTransferError("not-installed", `${packageName} is not a bundle of the active Profile`);
	const pluginDir = installedPackageDir(profileDir, packageName);
	if (pluginDir === void 0) throw new OfflinePluginTransferError("not-installed", `${packageName} is declared but not installed under the Profile`);
	const closure = dependencyClosure(profileDir, packageName);
	if (closure.packages.size + 1 > MAX_EXPORT_PACKAGES) throw new OfflinePluginTransferError("io", "dependency closure exceeds the supported package count");
	const queue = [{
		name: packageName,
		sourceDir: pluginDir,
		bytes: 0
	}, ...[...closure.packages].map(([name, sourceDir]) => ({
		name,
		sourceDir,
		bytes: 0
	}))];
	for (const entry of queue) entry.bytes = directoryBytes(entry.sourceDir);
	const bytesTotal = queue.reduce((total, entry) => total + entry.bytes, 0);
	const pluginVersion = packageVersionOf(pluginDir);
	const exportRoot = join(destination, `dsh-plugins__${sanitizedComponent(packageName)}__${sanitizedComponent(pluginVersion)}`);
	if (existsSync(exportRoot)) rmSync(exportRoot, {
		recursive: true,
		force: true
	});
	const packagesRoot = join(exportRoot, "packages");
	mkdirSync(packagesRoot, { recursive: true });
	const job = {
		id: `job_${String(Date.now())}_${randomUUID().slice(0, 8)}`,
		exportRoot,
		packagesRoot,
		queue,
		bytesTotal,
		unresolved: closure.unresolved,
		pluginName: packageName,
		pluginVersion,
		bytesDone: 0,
		packagesDone: 0,
		currentPackage: null,
		status: "running",
		error: null,
		exported: []
	};
	pruneExportJobs(Date.now());
	exportJobs.set(job.id, job);
	runExportJob(job);
	return {
		jobId: job.id,
		packages: queue.map((entry) => entry.name),
		totalBytes: bytesTotal,
		unresolved: closure.unresolved
	};
}
/** Copy loop for one export job. */
async function runExportJob(job) {
	try {
		for (const entry of job.queue) {
			job.currentPackage = entry.name;
			const target = join(job.packagesRoot, ...entry.name.split("/"));
			if (!existsSync(target)) {
				mkdirSync(dirname(target), { recursive: true });
				cpSync(entry.sourceDir, target, {
					recursive: true,
					dereference: true
				});
			}
			job.exported.push({
				name: entry.name,
				version: packageVersionOf(target)
			});
			job.bytesDone += entry.bytes;
			job.packagesDone += 1;
			await yieldToEventLoop();
		}
		const exportManifest = {
			kind: EXPORT_MANIFEST_KIND,
			formatVersion: 1,
			exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
			plugin: {
				name: job.pluginName,
				version: job.pluginVersion
			},
			packages: job.exported,
			unresolved: job.unresolved
		};
		writeFileSync(join(job.exportRoot, "manifest.json"), `${JSON.stringify(exportManifest, void 0, 2)}\n`, { flag: "wx" });
		job.currentPackage = null;
		job.status = "done";
	} catch (cause) {
		job.status = "failed";
		job.error = cause instanceof Error ? cause.message : String(cause);
		rmSync(job.exportRoot, {
			recursive: true,
			force: true
		});
	}
}
/** Snapshot one export job's progress. */
function exportJobProgress(jobId) {
	const job = typeof jobId === "string" ? exportJobs.get(jobId) : void 0;
	if (job === void 0) return {
		jobId: typeof jobId === "string" ? jobId : "",
		status: "unknown",
		error: null,
		packagesDone: 0,
		packagesTotal: 0,
		bytesDone: 0,
		bytesTotal: 0,
		currentPackage: null,
		exportPath: null,
		unresolved: []
	};
	return {
		jobId: job.id,
		status: job.status,
		error: job.error,
		packagesDone: job.packagesDone,
		packagesTotal: job.queue.length,
		bytesDone: job.bytesDone,
		bytesTotal: job.bytesTotal,
		currentPackage: job.currentPackage,
		exportPath: job.status === "done" ? job.exportRoot : null,
		unresolved: job.unresolved
	};
}
/** Register one bundle name in the Profile manifest under a file lock. */
async function registerBundle(profileDir, packageName) {
	const manifestPath = join(profileDir, "package.json");
	let registered = false;
	await withFileLock(manifestPath, async () => {
		const document = JSON.parse(readFileSync(manifestPath, "utf8"));
		const dsh = document.dsh ?? {};
		const profile = dsh.profile ?? {};
		const current = Array.isArray(profile.bundles) && profile.bundles.every((entry) => typeof entry === "string") ? profile.bundles : [];
		if (current.includes(packageName)) return;
		const next = {
			...document,
			dsh: {
				...dsh,
				profile: {
					...profile,
					bundles: [...current, packageName]
				}
			}
		};
		await writeFileAtomic(manifestPath, `${JSON.stringify(next, void 0, 2)}\n`, { mode: 384 });
		registered = true;
	});
	return registered;
}
/** Import one export directory into the active Profile. */
async function importProfilePlugin(profileDir, sourceDir) {
	const source = assertTransferPath("export directory", sourceDir);
	assertRealDirectory("export directory", source);
	const manifestPath = join(source, "manifest.json");
	if (!existsSync(manifestPath)) throw new OfflinePluginTransferError("invalid-manifest", `manifest.json is missing under ${source}`);
	let manifest;
	try {
		const content = readFileSync(manifestPath, "utf8");
		if (Buffer.byteLength(content, "utf8") > MAX_MANIFEST_BYTES) throw new OfflinePluginTransferError("invalid-manifest", "manifest is too large");
		manifest = JSON.parse(content);
	} catch (cause) {
		if (cause instanceof OfflinePluginTransferError) throw cause;
		throw new OfflinePluginTransferError("invalid-manifest", `manifest.json is not readable: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
	if (manifest.kind !== "dsh-offline-plugins-export" || manifest.formatVersion !== 1 || manifest.plugin === null || typeof manifest.plugin !== "object" || typeof manifest.plugin.name !== "string" || !isValidPackageName(manifest.plugin.name) || !Array.isArray(manifest.packages)) throw new OfflinePluginTransferError("invalid-manifest", "manifest is not a supported offline-plugins export");
	const packageName = manifest.plugin.name;
	const packagesRoot = realpathSync(join(source, "packages"));
	for (const entry of manifest.packages) {
		if (entry === null || typeof entry !== "object" || typeof entry.name !== "string" || !isValidPackageName(entry.name)) throw new OfflinePluginTransferError("invalid-manifest", "manifest package entry is invalid");
		assertRealDirectory(`package ${entry.name}`, join(packagesRoot, ...entry.name.split("/")));
	}
	const nodeModules = join(profileDir, "node_modules");
	if (!existsSync(nodeModules)) mkdirSync(nodeModules, { recursive: true });
	const imported = [];
	const skipped = [];
	for (const entry of manifest.packages) {
		const name = entry.name;
		const sourcePackage = join(packagesRoot, ...name.split("/"));
		const target = join(nodeModules, ...name.split("/"));
		if (existsSync(target)) {
			const existingVersion = packageVersionOf(target);
			if (existingVersion === packageVersionOf(sourcePackage)) {
				skipped.push(name);
				continue;
			}
			throw new OfflinePluginTransferError("conflict", `${name} already exists at version ${existingVersion}; remove it first to import ${packageVersionOf(sourcePackage)}`);
		}
		mkdirSync(dirname(target), { recursive: true });
		cpSync(sourcePackage, target, {
			recursive: true,
			dereference: true
		});
		imported.push(name);
		await yieldToEventLoop();
	}
	const registered = await registerBundle(profileDir, packageName);
	return {
		plugin: {
			name: packageName,
			version: manifest.plugin.version ?? packageVersionOf(join(nodeModules, ...packageName.split("/")))
		},
		imported,
		skipped,
		unresolved: Array.isArray(manifest.unresolved) ? manifest.unresolved.filter((entry) => typeof entry === "string") : [],
		registered,
		needsRestart: true
	};
}
//#endregion
//#region src/offline/http.ts
const MAX_BODY_BYTES = 16 * 1024;
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
async function readJsonPost(req, res) {
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
		if (size > MAX_BODY_BYTES) {
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
//#region src/offline/route.ts
function error(message) {
	return { error: message };
}
/** Handle `GET /_dsh/offline-plugins/list`. */
function handleListRequest(req, res, deps) {
	if (req.method !== "GET") {
		finishJson(res, 405, error("GET only"), "GET");
		return;
	}
	if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, false)) {
		finishJson(res, 403, error("same-origin request required"));
		return;
	}
	try {
		finishJson(res, 200, deps.list());
	} catch (cause) {
		finishJson(res, 500, error(cause instanceof Error ? cause.message : String(cause)));
	}
}
/** Handle `POST /_dsh/offline-plugins/export` (start a background job). */
function handleExportStartRequest(req, res, deps) {
	(async () => {
		if (req.method !== "POST") {
			finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) {
			finishJson(res, 403, error("same-origin request required"));
			return;
		}
		let body;
		try {
			body = await readJsonPost(req, res);
		} catch {
			return;
		}
		try {
			finishJson(res, 200, deps.startExport(body.packageName, body.destinationDir));
		} catch (cause) {
			finishJson(res, cause instanceof OfflinePluginTransferError && cause.code === "conflict" ? 409 : 400, error(cause instanceof Error ? cause.message : String(cause)));
		}
	})().catch(() => {});
}
/** Handle `GET /_dsh/offline-plugins/export/progress?jobId=...`. */
function handleExportProgressRequest(req, res, deps) {
	if (req.method !== "GET") {
		finishJson(res, 405, error("GET only"), "GET");
		return;
	}
	if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, false)) {
		finishJson(res, 403, error("same-origin request required"));
		return;
	}
	const jobId = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("jobId");
	finishJson(res, 200, deps.exportProgress(jobId));
}
/** Handle `POST /_dsh/offline-plugins/import`. */
function handleImportRequest(req, res, deps) {
	(async () => {
		if (req.method !== "POST") {
			finishJson(res, 405, error("POST only"), "POST");
			return;
		}
		if (!isSameOriginLoopbackRequest(req, deps.expectedOrigin, true)) {
			finishJson(res, 403, error("same-origin request required"));
			return;
		}
		let body;
		try {
			body = await readJsonPost(req, res);
		} catch {
			return;
		}
		try {
			finishJson(res, 200, await deps.importFrom(body.sourceDir));
		} catch (cause) {
			finishJson(res, 400, error(cause instanceof Error ? cause.message : String(cause)));
		}
	})().catch(() => {});
}
//#endregion
//#region src/offline/bridge.ts
/** Stable Cordis plugin name. */
const name = "offline-plugins-bridge";
/** Services resolved before routes register. */
const inject = [
	"webServer",
	"connection",
	"desktopPnpmBootstrap",
	"desktopPlugins"
];
/** Register the bridge: three private same-origin routes over the shared web server. */
function apply(ctx) {
	const desktop = ctx;
	const profileDir = desktop.desktopPnpmBootstrap.activeProfileDir;
	const rendererOrigin = `http://127.0.0.1:${String(ctx.webServer.port)}`;
	const mutableNames = () => {
		const names = /* @__PURE__ */ new Set();
		for (const bundle of desktop.desktopPlugins.list()) if (bundle.mutable) names.add(bundle.packageName);
		for (const immutableName of IMMUTABLE_BUNDLE_NAMES) names.delete(immutableName);
		return names;
	};
	const deps = {
		expectedOrigin: rendererOrigin,
		list: () => ({ plugins: listInstalledPlugins(profileDir, mutableNames(), new Set(desktop.desktopPlugins.disabledPackageNames())) }),
		startExport: (packageName, destinationDir) => startExportJob(profileDir, packageName, destinationDir),
		exportProgress: (jobId) => exportJobProgress(jobId),
		importFrom: (sourceDir) => importProfilePlugin(profileDir, sourceDir)
	};
	const routes = [
		[OFFLINE_PLUGINS_LIST_PATH, handleListRequest],
		[OFFLINE_PLUGINS_EXPORT_PATH, handleExportStartRequest],
		[OFFLINE_PLUGINS_EXPORT_PROGRESS_PATH, handleExportProgressRequest],
		[OFFLINE_PLUGINS_IMPORT_PATH, handleImportRequest]
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
	}), `offline-plugins: private route ${path}`);
}
//#endregion
export { OfflinePluginTransferError, apply, exportJobProgress, importProfilePlugin, inject, listInstalledPlugins, name, startExportJob };

//# sourceMappingURL=index.js.map