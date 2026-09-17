window.__ModuleLoader__.load({
	id: "dsh-plugin-offline-plugins",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/OfflinePluginsRow.tsx
		function OfflinePluginsRow(props) {
			const { entry, t, busy, onExport } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshOfflineItem",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshOfflineItemMain",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshOfflineItemName",
							children: entry.name
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshOfflineItemMeta",
							children: ["v", entry.version]
						})]
					}),
					entry.immutable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshOfflineBadge",
						children: t("immutableBadge")
					}),
					entry.disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshOfflineBadge",
						children: t("disabledBadge")
					}),
					!entry.immutable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshOfflineBtn",
						"data-variant": "ghost",
						disabled: busy,
						onClick: () => {
							onExport(entry.name);
						},
						children: t("exportAction")
					})
				]
			});
		}
		//#endregion
		//#region src/client/OfflinePluginsPanel.tsx
		/** Offline-plugins settings section: inline export/import management UI. */
		function formatMegabytes(bytes) {
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		}
		function OfflinePluginsSection(props) {
			const { api, t } = props;
			const [plugins, setPlugins] = (0, react.useState)();
			const [loadFailed, setLoadFailed] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(void 0);
			const [notice, setNotice] = (0, react.useState)(null);
			const [progress, setProgress] = (0, react.useState)(null);
			const pollTimer = (0, react.useRef)();
			const refresh = (0, react.useCallback)(async () => {
				const next = await api.list();
				setPlugins(next.plugins);
			}, [api]);
			(0, react.useEffect)(() => {
				refresh().catch(() => {
					setLoadFailed(true);
				});
			}, [refresh]);
			(0, react.useEffect)(() => () => {
				if (pollTimer.current !== void 0) clearInterval(pollTimer.current);
			}, []);
			const pickDirectory = async () => {
				try {
					return await api.pickDirectory();
				} catch {
					setNotice({
						kind: "error",
						text: t("pickFailed")
					});
					return null;
				}
			};
			const exportOne = async (name) => {
				setNotice(null);
				const destinationDir = await pickDirectory();
				if (destinationDir === null) return;
				let started;
				try {
					started = await api.startExport(name, destinationDir);
				} catch (cause) {
					setNotice({
						kind: "error",
						text: cause instanceof Error ? cause.message : t("unknownError")
					});
					return;
				}
				setProgress({
					jobId: started.jobId,
					packagesDone: 0,
					packagesTotal: started.packages.length,
					bytesDone: 0,
					bytesTotal: started.totalBytes,
					currentPackage: started.packages[0] ?? null
				});
				if (pollTimer.current !== void 0) clearInterval(pollTimer.current);
				pollTimer.current = setInterval(() => {
					(async () => {
						let snapshot;
						try {
							snapshot = await api.exportProgress(started.jobId);
						} catch {
							return;
						}
						setProgress({
							jobId: snapshot.jobId,
							packagesDone: snapshot.packagesDone,
							packagesTotal: snapshot.packagesTotal,
							bytesDone: snapshot.bytesDone,
							bytesTotal: snapshot.bytesTotal,
							currentPackage: snapshot.currentPackage
						});
						if (snapshot.status === "running") return;
						if (pollTimer.current !== void 0) clearInterval(pollTimer.current);
						pollTimer.current = void 0;
						setProgress(null);
						if (snapshot.status === "failed") {
							setNotice({
								kind: "error",
								text: snapshot.error ?? t("unknownError")
							});
							return;
						}
						const unresolved = snapshot.unresolved.length > 0 ? t("exportUnresolved") : "";
						setNotice({
							kind: "ok",
							text: `${t("exportDone")}: ${snapshot.exportPath ?? ""} (${String(snapshot.packagesTotal)} pkgs)${unresolved}`
						});
						await refresh().catch(() => {});
					})();
				}, 300);
			};
			const importOne = async () => {
				setNotice(null);
				const sourceDir = await pickDirectory();
				if (sourceDir === null) return;
				setBusy({ kind: "import" });
				try {
					const result = await api.importFrom(sourceDir);
					setNotice({
						kind: "ok",
						text: `${t("importDone")}: ${result.plugin.name}@${result.plugin.version} (+${String(result.imported.length)} deps) ${t("needsRestart")}`
					});
				} catch (cause) {
					setNotice({
						kind: "error",
						text: cause instanceof Error ? cause.message : t("unknownError")
					});
				} finally {
					setBusy(void 0);
				}
			};
			const importing = busy?.kind === "import";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshOfflineBody",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshOfflineIntro",
						children: t("intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dshOfflineHeading",
						children: t("installedHeading")
					}),
					loadFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshOfflineMsg",
						"data-kind": "error",
						children: t("loadFailed")
					}),
					!loadFailed && plugins !== void 0 && plugins.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshOfflineEmpty",
						children: t("noPlugins")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshOfflineList",
						children: (plugins ?? []).map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OfflinePluginsRow, {
							entry,
							t,
							busy: progress !== null,
							onExport: (name) => {
								exportOne(name);
							}
						}, entry.name))
					}),
					progress !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshOfflineProgressBlock",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshOfflineProgress",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshOfflineProgressFill",
								style: { width: `${progress.bytesTotal > 0 ? Math.min(100, Math.round(progress.bytesDone / progress.bytesTotal * 100)) : 0}%` }
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshOfflineProgressMeta",
							children: [
								t("exporting"),
								" ",
								String(progress.packagesDone),
								"/",
								String(progress.packagesTotal),
								" · ",
								formatMegabytes(progress.bytesDone),
								" / ",
								formatMegabytes(progress.bytesTotal),
								progress.currentPackage !== null && ` · ${progress.currentPackage}`
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "dshOfflineHeading",
						children: t("importHeading")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshOfflineBtn",
						disabled: busy !== void 0,
						onClick: () => {
							importOne();
						},
						children: importing ? t("importing") : t("importAction")
					}) }),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshOfflineMsg",
						"data-kind": notice.kind,
						children: notice.text
					})
				]
			});
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
		/** Launcher-owned directory chooser used by both flows. */
		const DIRECTORY_PICKER_PATH = "/_dsh/desktop/pick-directory";
		//#endregion
		//#region src/client/offline-plugins-api.ts
		/** Fetch wrapper for the offline-plugins host routes. */
		async function postJson(path, body) {
			const response = await fetch(path, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json"
				},
				body: JSON.stringify(body)
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) {
				const detail = value?.error;
				throw new Error(typeof detail === "string" && detail.length > 0 ? detail : `HTTP ${String(response.status)}`);
			}
			return value;
		}
		async function list() {
			const response = await fetch(OFFLINE_PLUGINS_LIST_PATH, { headers: { accept: "application/json" } });
			if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
			return await response.json();
		}
		async function pickDirectory() {
			const response = await fetch(DIRECTORY_PICKER_PATH, {
				method: "POST",
				headers: { accept: "application/json" }
			});
			if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
			const value = await response.json();
			if (typeof value !== "object" || value === null || !("path" in value)) return null;
			const path = value.path;
			return typeof path === "string" ? path : null;
		}
		function createOfflinePluginsApi() {
			return {
				list,
				startExport: (packageName, destinationDir) => postJson(OFFLINE_PLUGINS_EXPORT_PATH, {
					packageName,
					destinationDir
				}),
				exportProgress: async (jobId) => {
					const response = await fetch(`${OFFLINE_PLUGINS_EXPORT_PROGRESS_PATH}?jobId=${encodeURIComponent(jobId)}`, { headers: { accept: "application/json" } });
					if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
					return await response.json();
				},
				importFrom: (sourceDir) => postJson(OFFLINE_PLUGINS_IMPORT_PATH, { sourceDir }),
				pickDirectory
			};
		}
		//#endregion
		//#region src/client/offline-plugins-locales.ts
		const zh = {
			title: "离线插件管理",
			railTitle: "离线插件管理",
			intro: "导出本机已安装的 Profile 插件（含完整依赖），或导入其他电脑导出的插件目录。导入后重启生效。",
			close: "关闭",
			installedHeading: "已安装插件",
			importHeading: "从导出目录导入",
			importAction: "选择导出目录并导入",
			importing: "导入中",
			exportAction: "导出",
			exporting: "导出中",
			exportDone: "导出完成",
			importDone: "导入完成",
			needsRestart: "重启 法海问津 后新插件生效。",
			loadFailed: "无法读取插件清单。",
			pickFailed: "无法打开系统目录选择器。",
			immutableBadge: "内置",
			disabledBadge: "已禁用",
			exportUnresolved: "（部分依赖未随包导出，目标机器需已具备）",
			noPlugins: "当前 Profile 没有可管理的 Profile 级插件。",
			unknownError: "操作失败。"
		};
		const en = {
			title: "Offline Plugins",
			railTitle: "Offline plugin manager",
			intro: "Export installed Profile plugins (with their full dependency closure) or import an export directory from another machine. Imported plugins load after a restart.",
			close: "Close",
			installedHeading: "Installed plugins",
			importHeading: "Import from an export directory",
			importAction: "Choose export directory and import",
			importing: "Importing…",
			exportAction: "Export",
			exporting: "Exporting…",
			exportDone: "Export complete",
			importDone: "Import complete",
			needsRestart: "Restart 法海问津 to load newly imported plugins.",
			loadFailed: "The plugin inventory could not be read.",
			pickFailed: "The system folder picker could not be opened.",
			immutableBadge: "Built-in",
			disabledBadge: "Disabled",
			exportUnresolved: " (some dependencies were not included; the target machine must already provide them)",
			noPlugins: "The active Profile has no manageable Profile-level plugins.",
			unknownError: "The operation failed."
		};
		//#endregion
		//#region src/client/offline-plugins-styles.ts
		/** Offline-plugins panel styles, installed once per client boot. */
		const STYLE_ID = "dshOfflinePluginsStyles";
		const CSS_LINES = [
			".dshOfflineBody{display:flex;flex-direction:column;gap:10px;width:100%}",
			".dshOfflineHeading{margin:6px 0 0;font-size:13px;font-weight:600;opacity:.9}",
			".dshOfflineIntro{margin:0;font-size:12.5px;opacity:.75;line-height:1.5}",
			".dshOfflineList{display:flex;flex-direction:column;gap:6px}",
			".dshOfflineItem{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;",
			"  background:var(--dsh-hover,rgba(128,128,128,.1))}",
			".dshOfflineItemMain{flex:1;min-width:0}",
			".dshOfflineItemName{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dshOfflineItemMeta{font-size:11.5px;opacity:.65}",
			".dshOfflineBadge{font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px solid currentColor;opacity:.75}",
			".dshOfflineBtn{border:0;border-radius:8px;padding:7px 12px;cursor:pointer;font:inherit;font-size:12.5px;",
			"  background:var(--dsw-alias-button-primary-fill,#2563eb);color:var(--dsw-alias-label-primary-inverted,#fff);",
			"  transition:background var(--ds-transition-duration-fast,.15s) var(--ds-ease-in-out,ease)}",
			".dshOfflineBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#1d4ed8)}",
			".dshOfflineBtn:disabled{opacity:.5;cursor:default}",
			".dshOfflineBtn[data-variant=\"ghost\"]{background:var(--dsw-alias-button-tool-bar-fill,rgba(128,128,128,.12));",
			"  color:var(--dsw-alias-label-primary,#111)}",
			".dshOfflineBtn[data-variant=\"ghost\"]:hover:not(:disabled){background:var(--dsw-alias-button-tool-bar-hover,rgba(128,128,128,.2))}",
			".dshOfflineProgressBlock{display:flex;flex-direction:column;gap:4px}",
			".dshOfflineProgress{height:6px;border-radius:999px;overflow:hidden;",
			"  background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.15))}",
			".dshOfflineProgressFill{height:100%;border-radius:999px;",
			"  background:var(--dsw-alias-button-primary-fill,#2563eb);",
			"  transition:width var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease)}",
			".dshOfflineProgressMeta{font-size:11.5px;color:var(--dsw-alias-label-secondary,#555)}",
			".dshOfflineMsg{margin:0;font-size:12.5px;line-height:1.5}",
			".dshOfflineMsg[data-kind=\"error\"]{color:var(--dsw-static-red-500,#dc2626)}",
			".dshOfflineMsg[data-kind=\"ok\"]{color:var(--dsw-static-green-500,#16a34a)}",
			".dshOfflineEmpty{margin:0;font-size:12.5px;opacity:.6}"
		];
		function installOfflinePluginsStyles() {
			document.getElementById(STYLE_ID)?.remove();
			const element = document.createElement("style");
			element.id = STYLE_ID;
			element.textContent = CSS_LINES.join("\n");
			document.head.append(element);
			return () => {
				element.remove();
			};
		}
		//#endregion
		//#region src/client/offline-plugins.ts
		/** Locale namespace owned by the offline-plugins entry. */
		const OFFLINE_PLUGINS_LOCALE_NAMESPACE = "offline-plugins";
		/** Register the offline-plugins section in the settings page. */
		function applyOfflinePlugins(ctx) {
			const api = createOfflinePluginsApi();
			const t = ctx.locale.bind(OFFLINE_PLUGINS_LOCALE_NAMESPACE);
			ctx.effect(() => ctx.locale.register(OFFLINE_PLUGINS_LOCALE_NAMESPACE, {
				zh,
				en
			}), "dsh-plugin-offline-plugins: dictionaries");
			ctx.effect(() => installOfflinePluginsStyles(), "dsh-plugin-offline-plugins: styles");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "offline-plugins",
				order: 40,
				label: () => t("title"),
				locale: OFFLINE_PLUGINS_LOCALE_NAMESPACE,
				inject: () => ({ api })
			}, OfflinePluginsSection));
		}
		//#endregion
		//#region src/client/index.ts
		/** Services required by the offline-plugins settings section. */
		const inject = ["slots", "locale"];
		/** Register the offline-plugins client surfaces. @param ctx - browser Cordis context. */
		function apply(ctx) {
			applyOfflinePlugins(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.applyOfflinePlugins = applyOfflinePlugins;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map