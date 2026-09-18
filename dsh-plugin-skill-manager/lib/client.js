window.__ModuleLoader__.load({
	id: "dsh-plugin-skill-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/SkillManagerPanel.tsx
		/**
		* Skill-manager settings section: MCP servers and skills in two tabs.
		*
		* The layout follows the shipped Plugins settings page: a titled section, an
		* underline tab strip, and one card per configured thing — every row expands in
		* place into its own editor instead of replacing the list, so which entry is
		* being worked on stays visible while the form is open.
		*/
		/** Sentinel editor key for the not-yet-saved server card. */
		const NEW_ENTRY_KEY = "\0new";
		/**
		* Flatten an error and its `cause` chain into one line. The Host wraps every
		* failed MCP handshake in a generic message and keeps the real reason — an
		* HTTP status, a rejected token, a refused socket — on `cause`, so reporting
		* only `message` hides the one fact the user needs.
		*/
		function errorText(cause, fallback) {
			if (!(cause instanceof Error)) return fallback;
			const parts = [];
			let current = cause;
			while (current instanceof Error && parts.length < 4) {
				if (current.message.length > 0 && !parts.includes(current.message)) parts.push(current.message);
				current = current.cause;
			}
			return parts.length > 0 ? parts.join(" — ") : fallback;
		}
		function SkillManagerSection(props) {
			const { api, t } = props;
			const [tab, setTab] = (0, react.useState)("mcp");
			const [servers, setServers] = (0, react.useState)();
			const [skills, setSkills] = (0, react.useState)();
			const [loadFailed, setLoadFailed] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const refresh = (0, react.useCallback)(async () => {
				const next = await api.state();
				setServers(next.mcpServers);
				setSkills(next.skills);
			}, [api]);
			(0, react.useEffect)(() => {
				refresh().catch(() => {
					setLoadFailed(true);
				});
			}, [refresh]);
			const run = (0, react.useCallback)(async (action) => {
				setNotice(null);
				setBusy(true);
				try {
					const detail = await action();
					await refresh();
					setNotice({
						kind: "ok",
						text: detail === void 0 || detail === "" ? t("savedOk") : detail
					});
					return true;
				} catch (cause) {
					setNotice({
						kind: "error",
						text: errorText(cause, t("unknownError"))
					});
					return false;
				} finally {
					setBusy(false);
				}
			}, [refresh, t]);
			const report = (0, react.useCallback)((next) => {
				setNotice(next);
			}, []);
			const pickDirectory = (0, react.useCallback)(async () => {
				try {
					return await api.pickDirectory();
				} catch {
					setNotice({
						kind: "error",
						text: t("pickFailed")
					});
					return null;
				}
			}, [api, t]);
			const panelId = (0, react.useId)();
			const tabRefs = (0, react.useRef)([]);
			const tabs = [["mcp", "tabMcp"], ["skills", "tabSkills"]];
			const select = (next) => {
				setTab(next);
				setNotice(null);
			};
			const ready = servers !== void 0 && skills !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshSkillManagerSection",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "dshSkillManagerTitle",
						children: t("title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshSkillManagerIntro",
						children: t("intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshSkillManagerTabs",
						role: "tablist",
						"aria-label": t("title"),
						children: tabs.map(([id, label], index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							ref: (element) => {
								tabRefs.current[index] = element;
							},
							id: `${panelId}-tab-${id}`,
							type: "button",
							role: "tab",
							className: "dshSkillManagerTab",
							"data-active": tab === id,
							"aria-selected": tab === id,
							"aria-controls": `${panelId}-panel-${id}`,
							tabIndex: tab === id ? 0 : -1,
							onClick: () => {
								select(id);
							},
							onKeyDown: (event) => {
								let nextIndex;
								switch (event.key) {
									case "ArrowRight":
										nextIndex = (index + 1) % tabs.length;
										break;
									case "ArrowLeft":
										nextIndex = (index - 1 + tabs.length) % tabs.length;
										break;
									case "Home":
										nextIndex = 0;
										break;
									case "End":
										nextIndex = tabs.length - 1;
										break;
									default: return;
								}
								event.preventDefault();
								const next = tabs[nextIndex];
								if (next === void 0) return;
								select(next[0]);
								tabRefs.current[nextIndex]?.focus();
							},
							children: t(label)
						}, id))
					}),
					!ready && !loadFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshSkillManagerStatus",
						children: t("loading")
					}),
					loadFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBlock, { notice: {
						kind: "error",
						text: t("loadFailed")
					} }),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBlock, { notice }),
					ready && !loadFailed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshSkillManagerPanel",
						id: `${panelId}-panel-${tab}`,
						role: "tabpanel",
						"aria-labelledby": `${panelId}-tab-${tab}`,
						children: tab === "mcp" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(McpTab, {
							api,
							t,
							servers,
							busy,
							run
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillsTab, {
							api,
							t,
							skills,
							busy,
							run,
							report,
							pickDirectory
						})
					})
				]
			});
		}
		/** Status or failure line, tinted by kind. */
		function NoticeBlock(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: "dshSkillManagerNotice",
				"data-kind": props.notice.kind,
				role: props.notice.kind === "error" ? "alert" : "status",
				children: props.notice.text
			});
		}
		/** Read-only capsule badge; the tone selects the palette. */
		function StateTag(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dshSkillManagerTag",
				"data-tone": props.tone,
				children: props.children
			});
		}
		/** Two-state toggle; the accessible name is required at every render site. */
		function Toggle(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				role: "switch",
				"aria-checked": props.checked,
				"aria-label": props.label,
				title: props.label,
				disabled: props.disabled,
				className: "dshSkillManagerSwitch",
				onClick: () => {
					props.onChange(!props.checked);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshSkillManagerSwitchThumb" })
			});
		}
		/** Inline destructive confirmation, replacing the browser's own dialog. */
		function ConfirmBar(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshSkillManagerConfirm",
				role: "group",
				"aria-label": props.question,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshSkillManagerConfirmText",
						children: props.question
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshSkillManagerBtn",
						"data-size": "sm",
						"data-variant": "danger",
						disabled: props.busy,
						onClick: props.onConfirm,
						children: props.t("confirmYes")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshSkillManagerBtn",
						"data-size": "sm",
						"data-variant": "secondary",
						disabled: props.busy,
						onClick: props.onCancel,
						children: props.t("cancel")
					})
				]
			});
		}
		const EMPTY_MCP_FORM = {
			serverName: "",
			transport: "stdio",
			command: "",
			args: "",
			env: "",
			cwd: "",
			url: "",
			headers: ""
		};
		const MCP_JSON_TEMPLATE = `${JSON.stringify({
			serverName: "my-server",
			transport: "stdio",
			enabled: true,
			command: "npx",
			args: ["-y", "some-mcp-server"],
			env: {}
		}, void 0, 2)}\n`;
		function entryToJson(entry) {
			return `${JSON.stringify(entry, void 0, 2)}\n`;
		}
		/** The transport target shown on a collapsed card. */
		function serverTarget(server) {
			if (server.transport === "streamable-http") return server.url ?? "";
			return [server.command ?? "", ...server.args ?? []].join(" ").trim();
		}
		function parseKeyValueLines(raw, separator) {
			const result = {};
			for (const line of raw.split(/\r?\n/u)) {
				const trimmed = line.trim();
				if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
				const index = trimmed.search(separator);
				if (index <= 0) continue;
				const key = trimmed.slice(0, index).trim();
				const value = trimmed.slice(index).replace(separator, "").trim();
				if (key.length > 0) result[key] = value;
			}
			return result;
		}
		function toFormState(server) {
			return {
				serverName: server.serverName,
				transport: server.transport,
				command: server.command ?? "",
				args: (server.args ?? []).join("\n"),
				env: Object.entries(server.env ?? {}).map(([key, value]) => `${key}=${value}`).join("\n"),
				cwd: server.cwd ?? "",
				url: server.url ?? "",
				headers: Object.entries(server.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join("\n")
			};
		}
		function toServerEntry(form) {
			const args = form.args.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
			return form.transport === "stdio" ? {
				serverName: form.serverName.trim(),
				transport: "stdio",
				enabled: true,
				command: form.command.trim(),
				...args.length > 0 ? { args } : {},
				env: parseKeyValueLines(form.env, /=/u),
				...form.cwd.trim().length > 0 ? { cwd: form.cwd.trim() } : {}
			} : {
				serverName: form.serverName.trim(),
				transport: "streamable-http",
				enabled: true,
				url: form.url.trim(),
				headers: parseKeyValueLines(form.headers, /:\s*/u)
			};
		}
		/** Transport kinds the Host accepts; anything else is reported, never coerced. */
		function readTransport(value) {
			return value === "stdio" || value === "streamable-http" ? value : null;
		}
		/** Keep the string-valued entries of a JSON object; anything else is dropped. */
		function stringMapOf(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
			const result = {};
			for (const [key, item] of Object.entries(value)) if (typeof item === "string") result[key] = item;
			return result;
		}
		/**
		* Project a JSON entry onto the form's fields, or `null` when the value is not
		* an entry this editor can present.
		*
		* Only the JSON → form switch uses this. Submitting the JSON editor sends the
		* parsed value to the Host untouched: a projection covers the form's fields
		* only, so routing a save through one would silently drop `headers` and `env`.
		*/
		function toFormEntry(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
			const record = value;
			const transport = readTransport(record.transport);
			if (transport === null) return null;
			return {
				serverName: typeof record.serverName === "string" ? record.serverName : "",
				transport,
				enabled: true,
				...typeof record.command === "string" ? { command: record.command } : {},
				...Array.isArray(record.args) && record.args.every((item) => typeof item === "string") ? { args: record.args } : {},
				env: stringMapOf(record.env),
				...typeof record.cwd === "string" ? { cwd: record.cwd } : {},
				...typeof record.url === "string" ? { url: record.url } : {},
				headers: stringMapOf(record.headers)
			};
		}
		function McpTab(props) {
			const { api, t, servers, busy, run } = props;
			const [editing, setEditing] = (0, react.useState)(null);
			const [editorNotice, setEditorNotice] = (0, react.useState)(null);
			/** Server whose removal is awaiting confirmation, independent of the editor. */
			const [confirming, setConfirming] = (0, react.useState)(null);
			const [testing, setTesting] = (0, react.useState)(false);
			const [tools, setTools] = (0, react.useState)(null);
			/** Read one entry's tool catalog; a failure lands in the section, not the page. */
			const loadTools = (entry, probe) => {
				setTools({ status: "loading" });
				(async () => {
					try {
						const result = await api.listTools(entry, probe);
						setTools(result.ok ? {
							status: "ok",
							source: result.source ?? "probe",
							tools: result.tools
						} : {
							status: "error",
							detail: result.detail
						});
					} catch (cause) {
						setTools({
							status: "error",
							detail: errorText(cause, t("unknownError"))
						});
					}
				})();
			};
			const closeEditor = () => {
				setEditing(null);
				setEditorNotice(null);
				setConfirming(null);
				setTools(null);
			};
			const openEditor = (entry) => {
				setEditorNotice(null);
				setConfirming(null);
				const key = entry === null ? NEW_ENTRY_KEY : entry.serverName;
				if (editing?.key === key) {
					closeEditor();
					return;
				}
				setEditing({
					key,
					state: entry === null ? {
						mode: "form",
						form: EMPTY_MCP_FORM,
						json: MCP_JSON_TEMPLATE
					} : {
						mode: "form",
						form: toFormState(entry),
						json: entryToJson(entry)
					}
				});
				if (entry === null) setTools(null);
				else loadTools(entry, false);
			};
			const setState = (next) => {
				setEditing((current) => current === null ? null : {
					...current,
					state: next
				});
			};
			const patchForm = (patch) => {
				setEditing((current) => current === null ? null : {
					...current,
					state: {
						...current.state,
						form: {
							...current.state.form,
							...patch
						}
					}
				});
			};
			const switchMode = (mode) => {
				if (editing === null || editing.state.mode === mode) return;
				setEditorNotice(null);
				if (mode === "json") {
					setState({
						...editing.state,
						mode,
						json: entryToJson(toServerEntry(editing.state.form))
					});
					return;
				}
				const parsed = readJsonEntry(editing.state.json);
				if (parsed === void 0) return;
				const entry = toFormEntry(parsed);
				if (entry === null) {
					setEditorNotice({
						kind: "error",
						text: t("mcpTransportUnsupported")
					});
					return;
				}
				setState({
					...editing.state,
					mode,
					form: toFormState(entry)
				});
			};
			/** Parse the JSON editor, reporting the reason when it cannot be read. */
			function readJsonEntry(raw) {
				let parsed;
				try {
					parsed = JSON.parse(raw);
				} catch (cause) {
					setEditorNotice({
						kind: "error",
						text: `${t("mcpJsonInvalid")}: ${errorText(cause, "")}`
					});
					return;
				}
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
					setEditorNotice({
						kind: "error",
						text: t("mcpJsonNotObject")
					});
					return;
				}
				return parsed;
			}
			/** Read the editor into an entry, or report why it cannot be read. */
			const readEntry = (state) => {
				if (state.mode === "form") return toServerEntry(state.form);
				const parsed = readJsonEntry(state.json);
				if (parsed === void 0) return null;
				const record = parsed;
				if (readTransport(record.transport) === null) {
					setEditorNotice({
						kind: "error",
						text: t("mcpTransportUnsupported")
					});
					return null;
				}
				return record;
			};
			const submit = () => {
				if (editing === null) return;
				const entry = readEntry(editing.state);
				if (entry === null) return;
				(async () => {
					if (await run(async () => {
						await api.saveServer(entry);
					})) closeEditor();
				})();
			};
			const test = () => {
				if (editing === null || testing) return;
				const entry = readEntry(editing.state);
				if (entry === null) return;
				setEditorNotice(null);
				setTesting(true);
				(async () => {
					try {
						const result = await api.testServer(entry);
						setEditorNotice({
							kind: result.ok ? "ok" : "error",
							text: result.detail
						});
					} catch (cause) {
						setEditorNotice({
							kind: "error",
							text: errorText(cause, t("unknownError"))
						});
					} finally {
						setTesting(false);
					}
				})();
			};
			/** The server's tool catalog: live tools when it runs, a probe otherwise. */
			const renderTools = () => {
				if (tools === null) return null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshSkillManagerTools",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshSkillManagerToolsHead",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshSkillManagerToolsTitle",
									children: t("mcpTools")
								}),
								tools.status === "ok" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshSkillManagerGroupCount",
									children: `· ${String(tools.tools.length)}`
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateTag, {
									tone: "neutral",
									children: tools.source === "running" ? t("mcpToolsRunning") : t("mcpToolsProbe")
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshSkillManagerFooterSpacer" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshSkillManagerBtn",
									"data-size": "sm",
									"data-variant": "secondary",
									disabled: busy || tools.status === "loading",
									onClick: () => {
										const entry = editing === null ? null : readEntry(editing.state);
										if (entry !== null) loadTools(entry, true);
									},
									children: t("mcpToolsRefresh")
								})
							]
						}),
						tools.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshSkillManagerStatus",
							children: t("mcpToolsLoading")
						}),
						tools.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBlock, { notice: {
							kind: "error",
							text: tools.detail
						} }),
						tools.status === "ok" && tools.tools.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dshSkillManagerEmpty",
							children: t("mcpToolsEmpty")
						}),
						tools.status === "ok" && tools.tools.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: "dshSkillManagerToolsList",
							children: tools.tools.map((tool) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "dshSkillManagerTool",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshSkillManagerToolName",
									children: tool.name
								}), tool.description === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshSkillManagerToolDesc",
									children: tool.description.replace(/\s+/gu, " ").trim()
								})]
							}, tool.name))
						})
					]
				});
			};
			const renderEditor = (state) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshSkillManagerModes",
					role: "tablist",
					"aria-label": t("mcpEdit"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						className: "dshSkillManagerModeBtn",
						"data-active": state.mode === "form",
						"aria-selected": state.mode === "form",
						onClick: () => {
							switchMode("form");
						},
						children: t("mcpModeForm")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						className: "dshSkillManagerModeBtn",
						"data-active": state.mode === "json",
						"aria-selected": state.mode === "json",
						onClick: () => {
							switchMode("json");
						},
						children: t("mcpModeJson")
					})]
				}),
				editorNotice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBlock, { notice: editorNotice }),
				state.mode === "json" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: "dshSkillManagerField",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshSkillManagerFieldLabel",
						children: t("mcpJsonHint")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "dshSkillManagerTextarea",
						"data-size": "tall",
						value: state.json,
						spellCheck: false,
						onChange: (event) => {
							setState({
								...state,
								json: event.target.value
							});
						}
					})]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dshSkillManagerField",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshSkillManagerFieldLabel",
							children: t("mcpServerName")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dshSkillManagerInput",
							value: state.form.serverName,
							onChange: (event) => {
								patchForm({ serverName: event.target.value });
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dshSkillManagerField",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshSkillManagerFieldLabel",
							children: t("mcpTransportLabel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							className: "dshSkillManagerSelect",
							value: state.form.transport,
							onChange: (event) => {
								patchForm({ transport: event.target.value });
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "stdio",
								children: "stdio"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "streamable-http",
								children: "streamable-http"
							})]
						})]
					}),
					state.form.transport === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dshSkillManagerField",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshSkillManagerFieldLabel",
								children: t("mcpCommand")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dshSkillManagerInput",
								value: state.form.command,
								onChange: (event) => {
									patchForm({ command: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dshSkillManagerField",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshSkillManagerFieldLabel",
								children: t("mcpArgs")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "dshSkillManagerTextarea",
								value: state.form.args,
								onChange: (event) => {
									patchForm({ args: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dshSkillManagerField",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshSkillManagerFieldLabel",
								children: t("mcpEnv")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "dshSkillManagerTextarea",
								value: state.form.env,
								onChange: (event) => {
									patchForm({ env: event.target.value });
								}
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: "dshSkillManagerField",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshSkillManagerFieldLabel",
								children: t("mcpCwd")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dshSkillManagerInput",
								value: state.form.cwd,
								onChange: (event) => {
									patchForm({ cwd: event.target.value });
								}
							})]
						})
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dshSkillManagerField",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshSkillManagerFieldLabel",
							children: t("mcpUrl")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							className: "dshSkillManagerInput",
							value: state.form.url,
							placeholder: "https://example.invalid/mcp",
							onChange: (event) => {
								patchForm({ url: event.target.value });
							}
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "dshSkillManagerField",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshSkillManagerFieldLabel",
							children: t("mcpHeaders")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: "dshSkillManagerTextarea",
							value: state.form.headers,
							onChange: (event) => {
								patchForm({ headers: event.target.value });
							}
						})]
					})] })
				] }),
				renderTools(),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshSkillManagerFooter",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshSkillManagerFooterSpacer" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshSkillManagerBtn",
							"data-size": "sm",
							"data-variant": "secondary",
							disabled: busy || testing,
							onClick: test,
							children: t("mcpTest")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshSkillManagerBtn",
							"data-variant": "secondary",
							disabled: busy,
							onClick: closeEditor,
							children: t("cancel")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshSkillManagerBtn",
							"data-variant": "primary",
							disabled: busy,
							onClick: submit,
							children: t("save")
						})
					]
				})
			] });
			const creating = editing?.key === NEW_ENTRY_KEY;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshSkillManagerGroup",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dshSkillManagerGroupHead",
						children: [t("mcpHeading"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshSkillManagerGroupCount",
							children: `· ${String(servers.length)}`
						})]
					}),
					servers.length === 0 && !creating && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshSkillManagerEmpty",
						children: t("mcpEmpty")
					}),
					servers.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dshSkillManagerCards",
						children: servers.map((server) => {
							const open = editing?.key === server.serverName;
							const target = serverTarget(server);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "dshSkillManagerCard",
								"data-open": open,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dshSkillManagerCardHead",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dshSkillManagerCardToggle",
											"aria-expanded": open,
											"aria-label": `${server.serverName}: ${t("mcpEdit")}`,
											onClick: () => {
												openEditor(server);
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dshSkillManagerCardText",
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dshSkillManagerCardTitle",
														title: server.serverName,
														children: server.serverName
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dshSkillManagerCardMeta",
														title: target,
														children: target
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateTag, {
													tone: "outline",
													children: server.transport
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateTag, {
													tone: server.enabled ? "success" : "neutral",
													children: server.enabled ? t("mcpEnabled") : t("mcpDisabled")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dshSkillManagerChevron",
													"aria-hidden": "true"
												})
											]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dshSkillManagerCardActions",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
												checked: server.enabled,
												disabled: busy,
												label: `${server.serverName}: ${server.enabled ? t("mcpDisable") : t("mcpEnable")}`,
												onChange: (next) => {
													run(async () => {
														await api.toggleServer(server.serverName, next);
													});
												}
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dshSkillManagerBtn",
												"data-size": "sm",
												"data-variant": "danger",
												disabled: busy,
												onClick: () => {
													closeEditor();
													setConfirming(server.serverName);
												},
												children: t("mcpRemove")
											})]
										})]
									}),
									confirming === server.serverName && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshSkillManagerCardBody",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmBar, {
											t,
											busy,
											question: t("confirmRemove"),
											onCancel: () => {
												setConfirming(null);
											},
											onConfirm: () => {
												(async () => {
													if (await run(async () => {
														await api.removeServer(server.serverName);
													})) setConfirming(null);
												})();
											}
										})
									}),
									open && editing !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshSkillManagerCardBody",
										children: renderEditor(editing.state)
									})
								]
							}, server.serverName);
						})
					}),
					creating && editing !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshSkillManagerCard",
						"data-open": "true",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshSkillManagerCardHead",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshSkillManagerCardText",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dshSkillManagerCardTitle",
									children: t("mcpAdd")
								})
							})
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshSkillManagerCardBody",
							children: renderEditor(editing.state)
						})]
					})
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshSkillManagerActions",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dshSkillManagerBtn",
					"data-variant": "dashed",
					disabled: busy,
					onClick: () => {
						openEditor(null);
					},
					children: t("mcpAdd")
				})
			})] });
		}
		function skillKey(skill) {
			return `${skill.scope}/${skill.name}`;
		}
		function deriveNameFromContent(content) {
			return /^---\r?\nname:\s*([^\s]+)\s*$/mu.exec(content)?.[1] ?? "";
		}
		function SkillsTab(props) {
			const { api, t, skills, busy, run, report, pickDirectory } = props;
			const [editor, setEditor] = (0, react.useState)(null);
			const [editorNotice, setEditorNotice] = (0, react.useState)(null);
			const [confirming, setConfirming] = (0, react.useState)(null);
			const [opening, setOpening] = (0, react.useState)(null);
			const closeEditor = () => {
				setEditor(null);
				setEditorNotice(null);
				setConfirming(null);
			};
			const openEditor = (skill) => {
				const key = skillKey(skill);
				if (editor?.key === key) {
					closeEditor();
					return;
				}
				if (opening !== null) return;
				setEditorNotice(null);
				setConfirming(null);
				setOpening(key);
				(async () => {
					try {
						const value = await api.readSkill(skill.name, skill.scope);
						setEditor({
							key,
							name: skill.name,
							scope: skill.scope,
							content: value.content,
							readOnly: value.readOnly
						});
					} catch (cause) {
						report({
							kind: "error",
							text: errorText(cause, t("unknownError"))
						});
					} finally {
						setOpening(null);
					}
				})();
			};
			const save = () => {
				if (editor === null) return;
				const name = editor.scope === "user" ? editor.name : deriveNameFromContent(editor.content);
				(async () => {
					if (await run(async () => {
						await api.saveSkill(name, editor.content);
					})) closeEditor();
				})();
			};
			const grouped = [["system", skills.filter((skill) => skill.scope === "system")], ["user", skills.filter((skill) => skill.scope === "user")]];
			const creating = editor?.key === NEW_ENTRY_KEY;
			const renderEditor = () => {
				if (editor === null) return null;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					editor.readOnly && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshSkillManagerStatus",
						children: t("skillReadOnlyNote")
					}),
					editorNotice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoticeBlock, { notice: editorNotice }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "dshSkillManagerTextarea",
						"data-size": "tall",
						value: editor.content,
						spellCheck: false,
						"aria-label": t("skillContent"),
						onChange: (event) => {
							setEditor({
								...editor,
								content: event.target.value
							});
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshSkillManagerFooter",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dshSkillManagerFooterSpacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshSkillManagerBtn",
								"data-variant": "secondary",
								disabled: busy,
								onClick: closeEditor,
								children: t("cancel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshSkillManagerBtn",
								"data-variant": "primary",
								disabled: busy,
								onClick: save,
								children: t("save")
							})
						]
					})
				] });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				skills.length === 0 && !creating && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "dshSkillManagerEmpty",
					children: t("skillsEmpty")
				}),
				grouped.map(([scope, entries]) => entries.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshSkillManagerGroup",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dshSkillManagerGroupHead",
						children: [scope === "system" ? t("scopeSystem") : t("scopeUser"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshSkillManagerGroupCount",
							children: `· ${String(entries.length)}`
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dshSkillManagerCards",
						children: entries.map((skill) => {
							const key = skillKey(skill);
							const open = editor?.key === key;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: "dshSkillManagerCard",
								"data-open": open,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dshSkillManagerCardHead",
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dshSkillManagerCardText",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dshSkillManagerCardTitle",
													title: skill.name,
													children: skill.name
												}), skill.description === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dshSkillManagerCardDesc",
													title: skill.description,
													children: skill.description
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateTag, {
												tone: "outline",
												children: skill.scope === "system" ? t("scopeSystem") : t("scopeUser")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dshSkillManagerCardActions",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toggle, {
														checked: skill.enabled,
														disabled: busy,
														label: `${skill.name}: ${skill.enabled ? t("mcpDisable") : t("mcpEnable")}`,
														onChange: (next) => {
															run(async () => {
																await api.toggleSkill(skill.name, skill.scope, next);
															});
														}
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dshSkillManagerBtn",
														"data-size": "sm",
														"data-variant": "secondary",
														disabled: busy || opening !== null,
														onClick: () => {
															openEditor(skill);
														},
														children: open ? t("cancel") : t("skillEdit")
													}),
													skill.scope === "user" && !open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: "dshSkillManagerBtn",
														"data-size": "sm",
														"data-variant": "danger",
														disabled: busy,
														onClick: () => {
															closeEditor();
															setConfirming(key);
														},
														children: t("skillDelete")
													})
												]
											})
										]
									}),
									confirming === key && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshSkillManagerCardBody",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ConfirmBar, {
											t,
											busy,
											question: t("confirmDelete"),
											onCancel: () => {
												setConfirming(null);
											},
											onConfirm: () => {
												(async () => {
													if (await run(async () => {
														await api.deleteSkill(skill.name);
													})) setConfirming(null);
												})();
											}
										})
									}),
									open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshSkillManagerCardBody",
										children: renderEditor()
									})
								]
							}, key);
						})
					})]
				}, scope)),
				creating && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshSkillManagerCard",
					"data-open": "true",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshSkillManagerCardHead",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshSkillManagerCardText",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshSkillManagerCardTitle",
								children: t("skillNew")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshSkillManagerCardMeta",
								children: t("scopeUser")
							})]
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshSkillManagerCardBody",
						children: renderEditor()
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshSkillManagerActions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshSkillManagerBtn",
						"data-variant": "dashed",
						disabled: busy,
						onClick: () => {
							setConfirming(null);
							setEditor({
								key: NEW_ENTRY_KEY,
								name: "",
								scope: "user",
								content: t("skillTemplate"),
								readOnly: false
							});
							setEditorNotice(null);
						},
						children: t("skillNew")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshSkillManagerBtn",
						"data-variant": "dashed",
						disabled: busy,
						onClick: () => {
							(async () => {
								const sourceDir = await pickDirectory();
								if (sourceDir === null) return;
								await run(async () => {
									const imported = await api.importSkills(sourceDir);
									return imported.length > 0 ? imported.join(", ") : "";
								});
							})();
						},
						children: t("skillImport")
					})]
				})
			] });
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
		/** Launcher-owned directory chooser used by the import flow. */
		const DIRECTORY_PICKER_PATH = "/_dsh/desktop/pick-directory";
		//#endregion
		//#region src/client/skill-manager-api.ts
		/** Fetch wrapper for the skill-manager host routes. */
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
		function createSkillManagerApi() {
			return {
				async state() {
					const response = await fetch(SKILL_MANAGER_STATE_PATH, { headers: { accept: "application/json" } });
					if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
					return await response.json();
				},
				saveServer: (server) => postJson(SKILL_MANAGER_MCP_SAVE_PATH, { server }),
				removeServer: async (serverName) => {
					await postJson(SKILL_MANAGER_MCP_REMOVE_PATH, { serverName });
				},
				toggleServer: async (serverName, enabled) => {
					await postJson(SKILL_MANAGER_MCP_TOGGLE_PATH, {
						serverName,
						enabled
					});
				},
				testServer: (server) => postJson(SKILL_MANAGER_MCP_TEST_PATH, { server }),
				listTools: (server, probe) => postJson(SKILL_MANAGER_MCP_TOOLS_PATH, probe === true ? {
					server,
					probe: true
				} : { server }),
				toggleSkill: async (name, scope, enabled) => {
					await postJson(SKILL_MANAGER_SKILL_TOGGLE_PATH, {
						name,
						scope,
						enabled
					});
				},
				saveSkill: async (name, content) => {
					await postJson(SKILL_MANAGER_SKILL_SAVE_PATH, {
						name,
						content
					});
				},
				deleteSkill: async (name) => {
					await postJson(SKILL_MANAGER_SKILL_DELETE_PATH, { name });
				},
				importSkills: async (sourceDir) => {
					const value = await postJson(SKILL_MANAGER_SKILL_IMPORT_PATH, { sourceDir });
					return Array.isArray(value.imported) ? value.imported.filter((item) => typeof item === "string") : [];
				},
				readSkill: (name, scope) => {
					const query = `name=${encodeURIComponent(name)}&scope=${scope}`;
					return fetch(`${SKILL_MANAGER_SKILL_READ_PATH}?${query}`, { headers: { accept: "application/json" } }).then(async (response) => {
						if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
						return await response.json();
					});
				},
				pickDirectory
			};
		}
		//#endregion
		//#region src/client/skill-manager-locales.ts
		const zh = {
			title: "MCP 与技能管理",
			intro: "配置 MCP 服务器（即时生效，无需重启），管理系统级与用户级技能：启用禁用、导入、编写。",
			tabMcp: "MCP 服务器",
			tabSkills: "技能",
			mcpHeading: "已配置的 MCP 服务器",
			mcpEmpty: "尚未配置 MCP 服务器。",
			mcpName: "名称",
			mcpTransport: "传输",
			mcpTarget: "目标",
			mcpEnabled: "已启用",
			mcpDisabled: "已禁用",
			mcpAdd: "新增服务器",
			mcpEdit: "编辑",
			mcpRemove: "删除",
			mcpServerName: "服务器名称（字母、数字、下划线、连字符）",
			mcpTransportLabel: "传输方式",
			mcpCommand: "命令（可执行文件）",
			mcpArgs: "参数（每行一个）",
			mcpEnv: "环境变量（每行 KEY=VALUE）",
			mcpCwd: "工作目录（可选）",
			mcpUrl: "服务器 URL",
			mcpHeaders: "请求头（每行 KEY: VALUE）",
			mcpModeForm: "表单",
			mcpModeJson: "JSON",
			mcpJsonHint: "服务器配置 JSON（transport: stdio 需 command/args/env/cwd；streamable-http 需 url/headers）",
			mcpJsonInvalid: "JSON 无效",
			mcpJsonNotObject: "JSON 必须是一个描述服务器配置的对象。",
			mcpTransportUnsupported: "transport 只支持 stdio 或 streamable-http。",
			mcpTest: "测试",
			mcpEnable: "启用",
			mcpDisable: "禁用",
			mcpTools: "功能",
			mcpToolsLoading: "正在获取功能列表…",
			mcpToolsEmpty: "该服务器没有提供任何功能。",
			mcpToolsRefresh: "刷新",
			mcpToolsRunning: "运行中",
			mcpToolsProbe: "探测结果",
			save: "保存",
			cancel: "取消",
			skillsHeading: "技能列表",
			skillsEmpty: "没有发现任何技能。",
			scopeSystem: "系统",
			scopeUser: "用户",
			skillName: "技能名（小写字母、数字、连字符）",
			skillDescription: "描述",
			skillEdit: "编辑",
			skillDelete: "删除",
			skillNew: "新建技能",
			skillImport: "导入技能目录",
			skillContent: "技能内容（SKILL.md，含 frontmatter）",
			skillReadOnlyNote: "系统技能只读；编辑后会以用户技能保存并覆盖系统版本。",
			skillTemplate: "---\nname: my-skill\ndescription: 一句话说清什么场景使用、能做什么\n---\n\n# 操作步骤\n\n1. …\n",
			loading: "正在读取管理数据…",
			loadFailed: "无法读取管理数据。",
			pickFailed: "无法打开系统目录选择器。",
			savedOk: "已保存。",
			unknownError: "操作失败。",
			confirmRemove: "确定删除该 MCP 服务器配置？",
			confirmDelete: "确定删除该用户技能？文件将被移除。",
			confirmYes: "删除"
		};
		const en = {
			title: "MCP & Skills",
			intro: "Configure MCP servers (effective immediately, no restart) and manage system/user skills: enable, disable, import, and author.",
			tabMcp: "MCP servers",
			tabSkills: "Skills",
			mcpHeading: "Configured MCP servers",
			mcpEmpty: "No MCP servers configured yet.",
			mcpName: "Name",
			mcpTransport: "Transport",
			mcpTarget: "Target",
			mcpEnabled: "Enabled",
			mcpDisabled: "Disabled",
			mcpAdd: "Add server",
			mcpEdit: "Edit",
			mcpRemove: "Remove",
			mcpServerName: "Server name (letters, digits, underscore, hyphen)",
			mcpTransportLabel: "Transport",
			mcpCommand: "Command (executable)",
			mcpArgs: "Arguments (one per line)",
			mcpEnv: "Environment (KEY=VALUE per line)",
			mcpCwd: "Working directory (optional)",
			mcpUrl: "Server URL",
			mcpHeaders: "Headers (KEY: VALUE per line)",
			mcpModeForm: "Form",
			mcpModeJson: "JSON",
			mcpJsonHint: "Server entry JSON (stdio takes command/args/env/cwd; streamable-http takes url/headers)",
			mcpJsonInvalid: "Invalid JSON",
			mcpJsonNotObject: "The JSON must be an object describing a server entry.",
			mcpTransportUnsupported: "transport must be stdio or streamable-http.",
			mcpTest: "Test",
			mcpEnable: "Enable",
			mcpDisable: "Disable",
			mcpTools: "Tools",
			mcpToolsLoading: "Loading the tool list…",
			mcpToolsEmpty: "This server publishes no tools.",
			mcpToolsRefresh: "Refresh",
			mcpToolsRunning: "live",
			mcpToolsProbe: "probed",
			save: "Save",
			cancel: "Cancel",
			skillsHeading: "Skills",
			skillsEmpty: "No skills found.",
			scopeSystem: "System",
			scopeUser: "User",
			skillName: "Skill name (lowercase letters, digits, hyphens)",
			skillDescription: "Description",
			skillEdit: "Edit",
			skillDelete: "Delete",
			skillNew: "New skill",
			skillImport: "Import skill directory",
			skillContent: "Skill content (SKILL.md with frontmatter)",
			skillReadOnlyNote: "System skills are read-only; saving an edit creates a user skill that overrides the system one.",
			skillTemplate: "---\nname: my-skill\ndescription: One sentence on when to use it and what it does\n---\n\n# Steps\n\n1. …\n",
			loading: "Loading management data…",
			loadFailed: "The management data could not be read.",
			pickFailed: "The system folder picker could not be opened.",
			savedOk: "Saved.",
			unknownError: "The operation failed.",
			confirmRemove: "Remove this MCP server configuration?",
			confirmDelete: "Delete this user skill? Its files will be removed.",
			confirmYes: "Delete"
		};
		//#endregion
		//#region src/client/skill-manager-styles.ts
		/** Skill-manager panel styles, installed once per client boot. */
		const STYLE_ID = "dshSkillManagerStyles";
		const CSS = `
.dshSkillManagerSection {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerTitle { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }
.dshSkillManagerIntro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.dshSkillManagerTabs {
  display: flex;
  align-items: flex-end;
  gap: 22px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dshSkillManagerTab {
  position: relative;
  border: 0;
  padding: 7px 1px 9px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dshSkillManagerTab:hover,
.dshSkillManagerTab[data-active='true'] { color: var(--dsw-alias-label-primary); }
.dshSkillManagerTab[data-active='true']::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--dsw-alias-label-primary);
  content: '';
}
.dshSkillManagerTab:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 2px;
  color: var(--dsw-alias-label-primary);
}

.dshSkillManagerPanel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshSkillManagerStatus { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.dshSkillManagerNotice {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.dshSkillManagerNotice[data-kind='ok'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
.dshSkillManagerNotice[data-kind='error'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.dshSkillManagerGroup { display: flex; flex-direction: column; gap: 10px; }
.dshSkillManagerGroupHead {
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
.dshSkillManagerGroupCount { font-variant-numeric: tabular-nums; }

.dshSkillManagerCards { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dshSkillManagerCard {
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s, background .16s;
}
.dshSkillManagerCard:hover { border-color: var(--dsw-alias-label-dimmed); }
.dshSkillManagerCard[data-open='true'] {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.dshSkillManagerCardHead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.dshSkillManagerCardToggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshSkillManagerCardToggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshSkillManagerCardText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dshSkillManagerCardTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerCardDesc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerCardMeta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerCardActions { display: inline-flex; flex: none; align-items: center; gap: 8px; }

.dshSkillManagerChevron {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--dsw-alias-label-tertiary);
  transition: transform .16s;
}
.dshSkillManagerChevron::before {
  display: block;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  transform: rotate(45deg) translate(-1px, -1px);
  content: '';
}
.dshSkillManagerCardToggle[aria-expanded='true'] .dshSkillManagerChevron { transform: rotate(180deg); }

.dshSkillManagerCardBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 12px 0;
}

.dshSkillManagerModes {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshSkillManagerModeBtn {
  border: 0;
  border-radius: 8px;
  padding: 4px 12px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dshSkillManagerModeBtn:hover { color: var(--dsw-alias-label-primary); }
.dshSkillManagerModeBtn[data-active='true'] {
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerModeBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

.dshSkillManagerField { display: flex; flex-direction: column; gap: 6px; }
.dshSkillManagerFieldLabel { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dshSkillManagerInput,
.dshSkillManagerSelect,
.dshSkillManagerTextarea {
  box-sizing: border-box;
  width: 100%;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.dshSkillManagerInput,
.dshSkillManagerSelect { height: 32px; }
.dshSkillManagerSelect {
  appearance: none;
  /* Data-URI SVGs cannot resolve CSS variables; #81858C is the caption gray
     shared by both themes. */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px 12px;
  padding-right: 30px;
  cursor: pointer;
}
.dshSkillManagerTextarea {
  padding: 8px 10px;
  min-height: 96px;
  resize: vertical;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre;
  overflow-wrap: normal;
  overflow: auto;
}
.dshSkillManagerTextarea[data-size='tall'] { min-height: 260px; }
.dshSkillManagerInput::placeholder { color: var(--dsw-alias-label-dimmed); }
.dshSkillManagerInput:focus-visible,
.dshSkillManagerSelect:focus-visible,
.dshSkillManagerTextarea:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
}
.dshSkillManagerInput:disabled,
.dshSkillManagerSelect:disabled,
.dshSkillManagerTextarea:disabled { opacity: .6; cursor: default; }

.dshSkillManagerTools { display: flex; flex-direction: column; gap: 8px; }
.dshSkillManagerToolsHead { display: flex; align-items: center; gap: 8px; }
.dshSkillManagerToolsTitle {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerToolsList {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 10px;
  overflow: hidden;
}
.dshSkillManagerTool { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
.dshSkillManagerTool + .dshSkillManagerTool { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dshSkillManagerToolName {
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerToolDesc {
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dshSkillManagerFooter {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding-top: 12px;
}
.dshSkillManagerFooterSpacer { flex: 1; min-width: 0; }

.dshSkillManagerConfirm {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 10px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshSkillManagerConfirmText {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}

.dshSkillManagerBtn {
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
.dshSkillManagerBtn[data-size='sm'] {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 12px;
  line-height: 18px;
}
.dshSkillManagerBtn:disabled { opacity: .4; cursor: default; }
.dshSkillManagerBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshSkillManagerBtn[data-variant='primary'] {
  border: none;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshSkillManagerBtn[data-variant='primary']:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dshSkillManagerBtn[data-variant='secondary'] { border: 0.5px solid var(--dsw-alias-border-l3); }
.dshSkillManagerBtn[data-variant='secondary']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshSkillManagerBtn[data-variant='danger'] { color: var(--dsw-alias-state-error-primary); }
.dshSkillManagerBtn[data-variant='danger']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
.dshSkillManagerBtn[data-variant='dashed'] {
  flex: 1 1 0;
  min-width: 180px;
  height: 44px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 16px;
}
.dshSkillManagerBtn[data-variant='dashed']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }

.dshSkillManagerActions { display: flex; flex-wrap: wrap; gap: 10px; }

.dshSkillManagerTag {
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
.dshSkillManagerTag[data-tone='outline'] {
  border: 0.5px solid var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerTag[data-tone='neutral'] {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.dshSkillManagerTag[data-tone='success'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

/* The track keys its on/off appearance off aria-checked, so the visual state
   cannot disagree with the state assistive technology reads. */
.dshSkillManagerSwitch {
  box-sizing: border-box;
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 10px;
  corner-shape: round;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}
.dshSkillManagerSwitch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.dshSkillManagerSwitch:disabled { cursor: default; opacity: .5; }
.dshSkillManagerSwitch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshSkillManagerSwitchThumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-alias-label-primary-foreground);
  transition: transform 120ms ease;
}
.dshSkillManagerSwitch[aria-checked='true'] .dshSkillManagerSwitchThumb { transform: translateX(16px); }

.dshSkillManagerEmpty {
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
  .dshSkillManagerCard,
  .dshSkillManagerChevron,
  .dshSkillManagerBtn,
  .dshSkillManagerSwitchThumb { transition: none; }
}
`;
		function installSkillManagerStyles() {
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
		//#region src/client/skill-manager.ts
		/** Locale namespace owned by the skill-manager entry. */
		const SKILL_MANAGER_LOCALE_NAMESPACE = "skill-manager";
		/** Register the skill-manager section in the settings page. */
		function applySkillManager(ctx) {
			const api = createSkillManagerApi();
			const t = ctx.locale.bind(SKILL_MANAGER_LOCALE_NAMESPACE);
			ctx.effect(() => ctx.locale.register(SKILL_MANAGER_LOCALE_NAMESPACE, {
				zh,
				en
			}), "dsh-plugin-skill-manager: dictionaries");
			ctx.effect(() => installSkillManagerStyles(), "dsh-plugin-skill-manager: styles");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skill-manager",
				order: 45,
				label: () => t("title"),
				locale: SKILL_MANAGER_LOCALE_NAMESPACE,
				inject: () => ({ api })
			}, SkillManagerSection));
		}
		//#endregion
		//#region src/client/index.ts
		/** Services required by the skill-manager settings section. */
		const inject = ["slots", "locale"];
		/** Register the skill-manager client surfaces. @param ctx - browser Cordis context. */
		function apply(ctx) {
			applySkillManager(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.applySkillManager = applySkillManager;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map