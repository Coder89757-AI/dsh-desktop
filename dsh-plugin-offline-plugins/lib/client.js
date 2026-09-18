window.__ModuleLoader__.load({
	id: "dsh-plugin-offline-plugins",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/OfflinePluginsRow.tsx
		/** Read-only capsule badge; the tone selects the palette. */
		function StateTag(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dshOfflineTag",
				"data-tone": props.tone,
				children: props.children
			});
		}
		function OfflinePluginsRow(props) {
			const { entry, t, busy, active, onExport } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
				className: "dshOfflineCard",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshOfflineCardHead",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshOfflineCardText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshOfflineCardTitle",
								title: entry.name,
								children: entry.name
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshOfflineCardMeta",
								children: `v${entry.version}`
							})]
						}),
						entry.immutable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateTag, {
							tone: "info",
							children: t("immutableBadge")
						}),
						entry.disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateTag, {
							tone: "neutral",
							children: t("disabledBadge")
						}),
						!entry.immutable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshOfflineBtn",
							"data-size": "sm",
							"data-variant": "secondary",
							disabled: busy,
							onClick: () => {
								onExport(entry.name);
							},
							children: active ? t("exporting") : t("exportAction")
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/OfflinePluginsPanel.tsx
		/**
		* Offline-plugins settings section: inline export/import management UI.
		*
		* The layout follows the shipped Plugins settings page: a titled section, one
		* card per installed plugin, and a dashed "place a thing here" affordance for
		* the import flow that ends the page.
		*/
		function formatMegabytes(bytes) {
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		}
		/** Status or failure line, tinted by kind. */
		function NoticeBlock(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dshOfflineNotice",
				"data-kind": props.notice.kind,
				role: props.notice.kind === "error" ? "alert" : "status",
				children: props.notice.text
			});
		}
		function OfflinePluginsSection(props) {
			const { api, t } = props;
			const [plugins, setPlugins] = (0, react.useState)();
			const [loadFailed, setLoadFailed] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(void 0);
			const [notice, setNotice] = (0, react.useState)(null);
			const [progress, setProgress] = (0, react.useState)(null);
			/** Plugin whose dependency scan is running, before any job exists yet. */
			const [starting, setStarting] = (0, react.useState)(null);
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
			/** The export flow itself: pick a destination, start the job, then poll it. */
			const runExport = async (name) => {
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
				if (typeof started.jobId !== "string" || started.jobId === "") {
					setNotice({
						kind: "error",
						text: t("hostStale")
					});
					return;
				}
				setProgress({
					pluginName: name,
					jobId: started.jobId,
					packagesDone: 0,
					packagesTotal: started.packages.length,
					bytesDone: 0,
					bytesTotal: started.totalBytes,
					currentPackage: started.packages[0] ?? null
				});
				if (pollTimer.current !== void 0) clearInterval(pollTimer.current);
				let pollFailures = 0;
				pollTimer.current = setInterval(() => {
					(async () => {
						let snapshot;
						try {
							snapshot = await api.exportProgress(started.jobId);
							pollFailures = 0;
						} catch {
							pollFailures += 1;
							if (pollFailures >= 10) {
								if (pollTimer.current !== void 0) clearInterval(pollTimer.current);
								pollTimer.current = void 0;
								setProgress(null);
								setNotice({
									kind: "error",
									text: t("hostStale")
								});
							}
							return;
						}
						setProgress({
							pluginName: name,
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
			/**
			* Export one plugin, keeping its row busy for the whole call.
			*
			* The Host walks the entire dependency closure and totals its bytes before it
			* can answer with a job, and that wait is long enough to look hung when the
			* only feedback would be a progress bar that has not appeared yet.
			*/
			const exportOne = async (name) => {
				setNotice(null);
				setStarting(name);
				try {
					await runExport(name);
				} finally {
					setStarting(null);
				}
			};
			const importOne = async () => {
				setNotice(null);
				const sourceDir = await pickDirectory();
				if (sourceDir === null) return;
				setBusy({ kind: "import" });
				try {
					const result = await api.importFrom(sourceDir);
					const scopedDetail = result.scoped.length > 0 ? ` ${t("importScoped").replace("{n}", String(result.scoped.length))}` : "";
					setNotice({
						kind: "ok",
						text: `${t("importDone")}: ${result.plugin.name}@${result.plugin.version} (+${String(result.imported.length)} deps)${scopedDetail} ${t("needsRestart")}`
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
			const percent = progress === null || progress.bytesTotal <= 0 ? 0 : Math.min(100, Math.round(progress.bytesDone / progress.bytesTotal * 100));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshOfflineSection",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "dshOfflineTitle",
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshOfflineIntro",
						children: t("intro")
					}),
					loadFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBlock, { notice: {
						kind: "error",
						text: t("loadFailed")
					} }),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBlock, { notice }),
					!loadFailed && plugins === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshOfflineStatus",
						children: t("loading")
					}),
					plugins !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshOfflineGroup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dshOfflineGroupHead",
							children: [t("installedHeading"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshOfflineGroupCount",
								children: `· ${String(plugins.length)}`
							})]
						}), plugins.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshOfflineEmpty",
							children: t("noPlugins")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "dshOfflineCards",
							children: plugins.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OfflinePluginsRow, {
								entry,
								t,
								busy: starting !== null || progress !== null,
								active: starting === entry.name || progress?.pluginName === entry.name,
								onExport: (name) => {
									exportOne(name);
								}
							}, entry.name))
						})]
					}),
					starting !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshOfflineProgressBlock",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshOfflineProgressHead",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshOfflineProgressLabel",
									children: t("exporting")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshOfflineProgressNote",
									children: t("exportScanning")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshOfflineProgressSpacer" })
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshOfflineProgressTrack",
							role: "progressbar",
							"aria-label": t("exportScanning"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshOfflineProgressFill",
								"data-indeterminate": "true"
							})
						})]
					}),
					progress !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshOfflineProgressBlock",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshOfflineProgressHead",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshOfflineProgressLabel",
										children: t("exporting")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshOfflineProgressCount",
										children: `${String(progress.packagesDone)}/${String(progress.packagesTotal)}`
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshOfflineProgressSpacer" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshOfflineProgressBytes",
										children: `${formatMegabytes(progress.bytesDone)} / ${formatMegabytes(progress.bytesTotal)}`
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshOfflineProgressTrack",
								role: "progressbar",
								"aria-label": t("exporting"),
								"aria-valuemin": 0,
								"aria-valuemax": 100,
								"aria-valuenow": percent,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dshOfflineProgressFill",
									style: { width: `${String(percent)}%` }
								})
							}),
							progress.currentPackage !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "dshOfflineProgressPackage",
								title: progress.currentPackage,
								children: progress.currentPackage
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshOfflineGroup",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshOfflineGroupHead",
							children: t("importHeading")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshOfflineActions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshOfflineBtn",
								"data-variant": "dashed",
								disabled: busy !== void 0,
								onClick: () => {
									importOne();
								},
								children: importing ? t("importing") : t("importAction")
							})
						})]
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
			exportScanning: "正在扫描依赖…",
			exportDone: "导出完成",
			importDone: "导入完成",
			importScoped: "（{n} 个依赖因版本不同已放入该插件的私有依赖目录）",
			needsRestart: "重启 法海问津 后新插件生效。",
			loading: "正在读取插件清单…",
			loadFailed: "无法读取插件清单。",
			pickFailed: "无法打开系统目录选择器。",
			immutableBadge: "内置",
			disabledBadge: "已禁用",
			exportUnresolved: "（部分依赖未随包导出，目标机器需已具备）",
			noPlugins: "当前 Profile 没有可管理的 Profile 级插件。",
			unknownError: "操作失败。",
			hostStale: "Host 未加载新版离线插件接口（客户端已热更新）。请重启 法海问津 后重试。"
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
			exportScanning: "Scanning dependencies…",
			exportDone: "Export complete",
			importDone: "Import complete",
			importScoped: " ({n} dependencies with conflicting versions were placed in this plugin's private dependency directory)",
			needsRestart: "Restart 法海问津 to load newly imported plugins.",
			loading: "Loading the plugin inventory…",
			loadFailed: "The plugin inventory could not be read.",
			pickFailed: "The system folder picker could not be opened.",
			immutableBadge: "Built-in",
			disabledBadge: "Disabled",
			exportUnresolved: " (some dependencies were not included; the target machine must already provide them)",
			noPlugins: "The active Profile has no manageable Profile-level plugins.",
			unknownError: "The operation failed.",
			hostStale: "The Host is not running the new offline-plugins API (the client hot-reloaded). Restart 法海问津 and try again."
		};
		//#endregion
		//#region src/client/offline-plugins-styles.ts
		/** Offline-plugins panel styles, installed once per client boot. */
		const STYLE_ID = "dshOfflinePluginsStyles";
		const CSS = `
.dshOfflineSection {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
}
.dshOfflineTitle { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }
.dshOfflineIntro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.dshOfflineStatus { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.dshOfflineNotice {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.dshOfflineNotice[data-kind='ok'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
.dshOfflineNotice[data-kind='error'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.dshOfflineGroup { display: flex; flex-direction: column; gap: 10px; }
.dshOfflineGroupHead {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineGroupCount { font-variant-numeric: tabular-nums; }

.dshOfflineCards { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dshOfflineCard {
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s, background .16s;
}
.dshOfflineCard:hover { border-color: var(--dsw-alias-label-dimmed); }
.dshOfflineCardHead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.dshOfflineCardText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dshOfflineCardTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshOfflineCardMeta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}

.dshOfflineTag {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  corner-shape: round;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
}
.dshOfflineTag[data-tone='outline'] {
  border: 0.5px solid var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineTag[data-tone='neutral'] {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.dshOfflineTag[data-tone='info'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  color: var(--dsw-alias-state-business-primary);
}

.dshOfflineActions { display: flex; flex-wrap: wrap; gap: 10px; }
.dshOfflineBtn {
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  transition: background .16s, border-color .16s, color .16s;
}
.dshOfflineBtn[data-size='sm'] {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 12px;
  line-height: 18px;
}
.dshOfflineBtn:disabled { opacity: .4; cursor: default; }
.dshOfflineBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshOfflineBtn[data-variant='primary'] {
  border: none;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshOfflineBtn[data-variant='primary']:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dshOfflineBtn[data-variant='secondary'] { border: 0.5px solid var(--dsw-alias-border-l3); }
.dshOfflineBtn[data-variant='secondary']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshOfflineBtn[data-variant='dashed'] {
  flex: 1 1 0;
  min-width: 180px;
  height: 44px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 16px;
}
.dshOfflineBtn[data-variant='dashed']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }

.dshOfflineProgressBlock {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshOfflineProgressHead { display: flex; align-items: baseline; gap: 8px; }
.dshOfflineProgressLabel {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineProgressCount {
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
.dshOfflineProgressSpacer { flex: 1; min-width: 0; }
.dshOfflineProgressBytes {
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineProgressTrack {
  height: 6px;
  border-radius: 999px;
  corner-shape: round;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.dshOfflineProgressFill {
  height: 100%;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-button-primary-fill);
  transition: width .2s ease;
}
/* Before the job exists there is no ratio to show — the Host is still walking
   the dependency closure — so the bar sweeps instead of filling. */
.dshOfflineProgressFill[data-indeterminate='true'] {
  width: 30%;
  animation: dshOfflineProgressSweep 1.1s linear infinite;
}
@keyframes dshOfflineProgressSweep {
  from { transform: translateX(-110%); }
  to { transform: translateX(345%); }
}
.dshOfflineProgressNote {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineProgressPackage {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}

.dshOfflineEmpty {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 12px;
  text-align: center;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

@media (prefers-reduced-motion: reduce) {
  .dshOfflineCard,
  .dshOfflineBtn,
  .dshOfflineProgressFill { transition: none; }

  /* A still bar at a fixed fraction still reads as "work in progress". */
  .dshOfflineProgressFill[data-indeterminate='true'] { animation: none; width: 40%; }
}
`;
		function installOfflinePluginsStyles() {
			document.getElementById(STYLE_ID)?.remove();
			const element = document.createElement("style");
			element.id = STYLE_ID;
			element.textContent = CSS;
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