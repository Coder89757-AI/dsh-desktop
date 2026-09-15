window.__ModuleLoader__.load({
	id: "dsh-auth-gate",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		/**
		* 授权状态。**fail-closed 是设计前提**：初始态是 `checking` 而不是某种"乐观放行"，
		* 且闸门把 `checking` 与 `unreachable` 一并视为未授权。
		*/
		const AUTH_STATUS = Object.freeze({
			/** 尚未得出结论（启动后的第一瞬间）。闸门在此态下拒绝。 */
			CHECKING: "checking",
			/** 已确认未授权：无记录、凭据被服务端否定、或用户已登出。 */
			UNAUTHENTICATED: "unauthenticated",
			/** 已授权：本地记录有效且服务端校验通过。 */
			AUTHENTICATED: "authenticated",
			/**
			* 服务器不可达（超时 / 连接失败 / 5xx）。
			*
			* 与 `UNAUTHENTICATED` 分开是刻意的：用户的下一步动作完全不同 ——
			* 前者是"检查网络或联系管理员"，后者是"重新登录"。
			* 两者对闸门的含义相同：都拒绝。
			*/
			UNREACHABLE: "unreachable"
		});
		/** 闸门形态。见 lib/gate-mode.js。 */
		const GATE_MODE = Object.freeze({
			/** 登录页覆盖在 AppFrame 之上（上游推荐的 `shell.overlay`）。 */
			OVERLAY: "overlay",
			/** 用 `priority:-1` 遮蔽 `root`，AppFrame 组件根本不挂载。 */
			ROOT_SHADOW: "root-shadow"
		});
		/** 配置默认值。`cordis.patch.yml` 里写的是同一份，这里是代码侧兜底。 */
		const DEFAULT_CONFIG = Object.freeze({
			gateMode: GATE_MODE.OVERLAY,
			serverAddress: "",
			allowHttp: false,
			timeoutMs: 5e3,
			paths: Object.freeze({
				verify: "/api/auth/verify",
				login: "/api/auth/login",
				refresh: "/api/auth/refresh",
				logout: "/api/auth/logout"
			}),
			fields: Object.freeze({
				token: "token",
				refreshToken: "refreshToken",
				expiresIn: "expiresIn",
				user: "user"
			})
		});
		/** Host 与 Client 之间的同源 HTTP 前缀（客户端 fetch 用同一个常量）。 */
		const API_PREFIX = "/api/auth-gate";
		/**
		* 把 Loader 传来的原始 config 归一化成完整配置。
		*
		* 手写而不是用 schemastery：这个包零依赖，而 schemastery 是一个运行时依赖。
		* 归一化的目标是"任何垃圾输入都得到一个可用的配置"，而不是拒绝启动 ——
		* 一个配错字段的门禁插件不应该把整个应用带下去。
		*
		* @param {unknown} raw - Loader 行上的 `config`。
		* @returns {typeof DEFAULT_CONFIG} 完整配置。
		*/
		function normalizeConfig(raw) {
			const source = raw && typeof raw === "object" ? raw : {};
			const timeout = Number(source.timeoutMs);
			return {
				gateMode: source.gateMode === GATE_MODE.ROOT_SHADOW ? GATE_MODE.ROOT_SHADOW : GATE_MODE.OVERLAY,
				serverAddress: typeof source.serverAddress === "string" ? source.serverAddress.trim() : "",
				allowHttp: source.allowHttp === true,
				timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_CONFIG.timeoutMs,
				paths: {
					...DEFAULT_CONFIG.paths,
					...source.paths ?? {}
				},
				fields: {
					...DEFAULT_CONFIG.fields,
					...source.fields ?? {}
				}
			};
		}
		//#endregion
		//#region dsh-auth-gate/lib/gate-mode.js
		/**
		* 闸门形态开关。
		*
		* 两种形态用的是**同一个**登录页组件，差别只在注册到哪个槽位、以及要不要给
		* `priority`。所以这里的全部职责就是把这个差别翻译成 `ctx.slots.register` 的
		* 参数 —— 一份真相，Host 与 Client 都不再各自判断。
		*
		* 形态对照（决策于 2026-09-15，见 .workbuddy/auth-gate-plugin-assessment.md §6.3）：
		*
		* | | overlay | root-shadow |
		* |---|---|---|
		* | 注册目标 | `shell.overlay`（list/root，上游推荐） | `root`（single/root） |
		* | 视觉 | 登录页覆盖在 AppFrame 之上 | 整页只有登录页 |
		* | 强度 | 中 —— AppFrame 仍在后台挂载，全局快捷键等旁路需实测 | 强 —— AppFrame 组件不挂载 |
		* | 副作用面 | 小 | 有（见下方两条硬约束） |
		*
		* `root-shadow` 的两条硬约束都是"踩了就直接抛错"或"静默丢服务"，不能靠试错：
		*
		* 1. **绝不传 `children`**。`ui-layout` 已经声明了 `sidebar`/`main`/`rightbar`/
		*    `shell.overlay` 四个子槽位，而 `SlotCore.register` 对"已声明的子槽位"直接
		*    `throw`（`dsh-client-ui-slots/lib/index.js`）。桌面的 `advanced-shell.ts` 能传
		*    children 是因为它**先禁用了 `ui-layout` 行**，第三方插件付不起这个代价。
		* 2. **不禁用 `ui-layout` 行**。它的 `apply()` 里除了注册 root，还 `provide('layout')`、
		*    `provideRoot({hooks:{panelInfo}})`、`subscribe('main', retainMainPanels)`。
		*    禁用它 = 丢掉 `ctx.layout` 服务。遮蔽只能遮蔽**渲染**，不能遮蔽**服务** ——
		*    所以用 `priority:-1` 让 AppFrame 不渲染，那行本身照常运行。
		*
		* 另外：`root` 上官方 AppFrame 的注册没给 priority（=0），而同一 cell 同 priority
		* 的第二次注册会抛错，所以遮蔽**必须**显式给负数。
		*/
		/** `overlay` 形态在 `shell.overlay` 里的条目 id。与包名一致便于辨认。 */
		const OVERLAY_ENTRY_ID = "auth-gate";
		/**
		* `overlay` 形态的显示顺序。
		*
		* 取一个很负的值：闸门必须是覆盖层里最先渲染的那个，否则市场上别的 overlay
		* （比如社区市场的浮层）会画在登录页之上，把凭据输入框遮住。
		*/
		const OVERLAY_ORDER = -1e3;
		/**
		* 把形态名解析成 `ctx.slots.register` 的选项。
		*
		* 注意返回值**故意不含 `priority` 以外的任何可选字段**：调用方把它展开进
		* register 的 options 即可，不要自己再补 `children`（见文件头约束 1）。
		*
		* @param {string} mode - `GATE_MODE.OVERLAY` 或 `GATE_MODE.ROOT_SHADOW`。
		* @returns {{name: string, id?: string, order?: number, priority?: number}} 注册选项。
		*/
		function resolveGateTarget(mode) {
			if (mode === GATE_MODE.ROOT_SHADOW) return {
				name: "root",
				priority: -1
			};
			return {
				name: "shell.overlay",
				id: OVERLAY_ENTRY_ID,
				order: OVERLAY_ORDER
			};
		}
		//#endregion
		//#region dsh-auth-gate/src/client/gate-controller.js
		/**
		* Client 侧的状态代理。
		*
		* 渲染器与 Host 之间走**同源 HTTP**（主窗口的 origin 就是
		* `http://127.0.0.1:<webServer.port>`，所以同源 fetch 可用，桌面自己的设置页
		* 也是这么干的）。没有用 Typert Remote —— 那条路需要把编译期描述符生成接进
		* 本包的构建，而这个包刻意零构建。
		*
		* `getSnapshot()` 返回**稳定引用**（只在变化时换新对象），这样它可以安全地喂给
		* React 的 `useSyncExternalStore`；每次调用都新建对象的写法会让 React 无限重渲染。
		*/
		/** 状态轮询间隔。登录成功/失败会立刻触发一次刷新，所以这只是在兜底。 */
		const DEFAULT_INTERVAL_MS = 1500;
		/**
		* 建一个闸门控制器。
		*
		* @param {object} [options] - 选项。
		* @param {string} [options.serverAddress] - 配置里的默认服务器地址。
		* @param {number} [options.intervalMs] - 轮询间隔。
		* @returns {object} 控制器。
		*/
		function createGateController(options = {}) {
			const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : DEFAULT_INTERVAL_MS;
			const defaultServerAddress = typeof options.serverAddress === "string" ? options.serverAddress : "";
			let view = Object.freeze({
				snapshot: Object.freeze({
					status: AUTH_STATUS.CHECKING,
					reason: null,
					username: null,
					serverAddress: defaultServerAddress,
					expiresAt: null
				}),
				/** 最近一次登录动作的失败原因码；与 Host 的状态原因分开存。 */
				failure: null
			});
			const listeners = /* @__PURE__ */ new Set();
			let timer = null;
			const publish = (patch) => {
				view = Object.freeze({
					...view,
					...patch
				});
				for (const listener of listeners) try {
					listener();
				} catch {}
			};
			/** 拉一次状态。Host 还没起来时静默跳过，下一轮再试。 */
			const poll = async () => {
				try {
					const response = await fetch(`${API_PREFIX}/state`, {
						headers: { accept: "application/json" },
						cache: "no-store"
					});
					if (!response.ok) return;
					const data = await response.json();
					if (data && typeof data.state === "object" && data.state !== null) publish({ snapshot: Object.freeze(data.state) });
				} catch {}
			};
			/**
			* 发一个 POST 动作并吸收结果。
			*
			* @param {string} path - 相对路径（接在 {@link API_PREFIX} 后）。
			* @param {object} [body] - 请求体。
			* @returns {Promise<{ok: boolean, failure?: string}>} 结果。
			*/
			const post = async (path, body) => {
				let response;
				try {
					response = await fetch(`${API_PREFIX}${path}`, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json"
						},
						body: body === void 0 ? void 0 : JSON.stringify(body),
						cache: "no-store"
					});
				} catch {
					publish({ failure: "transport" });
					return {
						ok: false,
						failure: "transport"
					};
				}
				let data = null;
				try {
					data = await response.json();
				} catch {}
				if (data && typeof data.state === "object" && data.state !== null) publish({ snapshot: Object.freeze(data.state) });
				if (response.ok && data?.ok === true) {
					publish({ failure: null });
					return { ok: true };
				}
				const failure = typeof data?.failure === "string" ? data.failure : "internal";
				publish({ failure });
				return {
					ok: false,
					failure
				};
			};
			return {
				/** @returns {object} 稳定引用的视图对象。 */
				getSnapshot: () => view,
				/**
				* 订阅变化。
				* @param {() => void} listener - 变化回调。
				* @returns {() => void} 退订。
				*/
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				/** 开始轮询（幂等）。 */
				start() {
					if (timer !== null) return;
					poll();
					timer = setInterval(() => {
						poll();
					}, intervalMs);
				},
				/** 停止轮询。 */
				stop() {
					if (timer === null) return;
					clearInterval(timer);
					timer = null;
				},
				/** @returns {boolean} 当前是否已授权。 */
				isAuthorized: () => view.snapshot.status === AUTH_STATUS.AUTHENTICATED,
				/**
				* 提交登录。
				* @param {{serverAddress?: string, username: string, password: string}} payload - 表单。
				* @returns {Promise<{ok: boolean, failure?: string}>} 结果。
				*/
				login: (payload) => post("/login", payload),
				/**
				* 退出登录。
				* @returns {Promise<{ok: boolean, failure?: string}>} 结果。
				*/
				logout: () => post("/logout"),
				/**
				* 让 Host 重新做一次启动校验（服务器不可达时的"重新检查"）。
				* @returns {Promise<{ok: boolean, failure?: string}>} 结果。
				*/
				recheck: () => post("/refresh-check"),
				/** @returns {string} 配置里的默认服务器地址。 */
				getDefaultServerAddress: () => defaultServerAddress
			};
		}
		//#endregion
		//#region dsh-auth-gate/src/client/locales.js
		/**
		* 中英字典。
		*
		* 只覆盖闸门界面自己的文案。**服务端返回的报错原文不进字典** —— 我们的 HTTP 面
		* 只回稳定原因码（`failure`），文案在这里按码解析，所以服务端怎么改报文都不会
		* 让界面出现英文堆栈或内网地址。
		*/
		/** locale 命名空间。与 `slots.register({ locale })` 里写的值必须一致。 */
		const NS = "auth-gate";
		const zh = {
			title: "需要授权",
			subtitle: "请使用统一账号登录后继续。",
			fieldServer: "服务器地址",
			fieldUsername: "用户名",
			fieldPassword: "密码",
			placeholderServer: "https://auth.example.com",
			submit: "登录",
			submitting: "正在登录…",
			retry: "重新检查",
			checking: "正在校验授权…",
			unreachableTitle: "无法连接授权服务器",
			unreachableHint: "请检查网络或联系管理员。服务器恢复后重新检查即可，无需重新登录。",
			unauthenticatedTitle: "登录已失效",
			expiredHint: "授权已过期，请重新登录。",
			logoutHint: "你已退出登录。",
			logout: "退出登录",
			signedInAs: "当前账号",
			expiresAt: "有效期至",
			memoryOnly: "访问令牌仅保存在内存中，重启应用后需要重新认证。",
			errAddressMissing: "请填写服务器地址。",
			errAddressInvalid: "服务器地址格式不正确。",
			errAddressScheme: "服务器地址必须以 http:// 或 https:// 开头。",
			errAddressInsecure: "出于安全考虑，仅支持 https。如需使用内网 http 地址，请让管理员在插件配置中开启。",
			errAddressUserinfo: "请不要把账号密码写在服务器地址里。",
			errCredentialsMissing: "请填写用户名和密码。",
			errTransport: "无法连接服务器，请检查网络后重试。",
			errRejected: "用户名、密码或授权信息不正确。",
			errMalformed: "服务器返回的数据无法识别，请联系管理员。",
			errServerError: "服务器暂时不可用，请稍后重试。",
			errForbidden: "请求来源不被允许。",
			errBadRequest: "请求格式不正确。",
			errInternal: "插件内部错误，请联系管理员。",
			errUnknown: "登录失败，请重试。"
		};
		const en = {
			title: "Authorization required",
			subtitle: "Sign in with your directory account to continue.",
			fieldServer: "Server address",
			fieldUsername: "Username",
			fieldPassword: "Password",
			placeholderServer: "https://auth.example.com",
			submit: "Sign in",
			submitting: "Signing in…",
			retry: "Check again",
			checking: "Verifying authorization…",
			unreachableTitle: "Cannot reach the authorization server",
			unreachableHint: "Check your network or contact your administrator. Retrying after the server recovers needs no new sign-in.",
			unauthenticatedTitle: "Session expired",
			expiredHint: "Your authorization expired. Please sign in again.",
			logoutHint: "You signed out.",
			logout: "Sign out",
			signedInAs: "Signed in as",
			expiresAt: "Valid until",
			memoryOnly: "The access token lives in memory only; a restart requires re-authentication.",
			errAddressMissing: "Enter the server address.",
			errAddressInvalid: "The server address is not a valid URL.",
			errAddressScheme: "The server address must start with http:// or https://.",
			errAddressInsecure: "Only https is accepted. Ask your administrator to enable plain http in the plugin config if your intranet host requires it.",
			errAddressUserinfo: "Do not put credentials inside the server address.",
			errCredentialsMissing: "Enter a username and password.",
			errTransport: "Cannot reach the server. Check your network and retry.",
			errRejected: "The username, password, or authorization was not accepted.",
			errMalformed: "The server response could not be understood. Contact your administrator.",
			errServerError: "The server is temporarily unavailable. Try again shortly.",
			errForbidden: "The request origin is not allowed.",
			errBadRequest: "Malformed request.",
			errInternal: "Internal plugin error. Contact your administrator.",
			errUnknown: "Sign-in failed. Please retry."
		};
		/**
		* 把 HTTP 面返回的 `failure` 码解析成字典键。
		*
		* 单点映射：界面拿不到码对应的文案时回落到 `errUnknown`，**绝不把码本身显示给用户**。
		*
		* @param {string|undefined} failure - 原因码。
		* @returns {string} 字典键。
		*/
		function failureKey(failure) {
			return {
				"address-missing": "errAddressMissing",
				"address-invalid": "errAddressInvalid",
				"address-scheme": "errAddressScheme",
				"address-insecure": "errAddressInsecure",
				"address-userinfo": "errAddressUserinfo",
				"credentials-missing": "errCredentialsMissing",
				transport: "errTransport",
				rejected: "errRejected",
				malformed: "errMalformed",
				"server-error": "errServerError",
				forbidden: "errForbidden",
				"bad-request": "errBadRequest",
				internal: "errInternal"
			}[failure] ?? "errUnknown";
		}
		//#endregion
		//#region dsh-auth-gate/src/client/gate-view.js
		/**
		* 全屏登录 / 拦截页。
		*
		* **这一个组件同时服务两种闸门形态**（`overlay` 与 `root-shadow`）—— 差别只在
		* 注册到哪个槽位（见 lib/gate-mode.js）。所以这里不需要知道任何关于形态的事，
		* 样式上也不能依赖"父容器会给我多大地方"：`.dsAuthGate` 用 `position: fixed;
		* inset: 0` 自己铺满视口。
		*
		* 用 `createElement` 而不是 JSX：这个包零构建、零依赖，不引入编译器。
		*/
		/**
		* 闸门页组件。
		*
		* @param {object} props - 组合 props。
		* @param {object} props.gate - 闸门控制器（由注册处的 `inject` 注入）。
		* @param {(key: string) => string} [props.t] - locale 命名空间绑定的翻译函数。
		* @returns {object|null} React 节点；已授权时返回 null。
		*/
		function AuthGateView(props) {
			const gate = props.gate;
			const tr = typeof props.t === "function" ? props.t : (key) => key;
			const view = (0, react.useSyncExternalStore)(gate.subscribe, gate.getSnapshot, gate.getSnapshot);
			const status = view.snapshot.status;
			const [serverAddress, setServerAddress] = (0, react.useState)(gate.getDefaultServerAddress());
			const [username, setUsername] = (0, react.useState)("");
			const [password, setPassword] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const element = rootRef.current;
				if (element === null) return void 0;
				const swallow = (event) => event.stopPropagation();
				element.addEventListener("keydown", swallow);
				element.addEventListener("keyup", swallow);
				element.addEventListener("keypress", swallow);
				return () => {
					element.removeEventListener("keydown", swallow);
					element.removeEventListener("keyup", swallow);
					element.removeEventListener("keypress", swallow);
				};
			}, []);
			const submit = (0, react.useCallback)(async (event) => {
				event.preventDefault();
				if (busy) return;
				setBusy(true);
				try {
					await gate.login({
						serverAddress,
						username,
						password
					});
				} finally {
					setBusy(false);
					setPassword("");
				}
			}, [
				busy,
				gate,
				password,
				serverAddress,
				username
			]);
			const recheck = (0, react.useCallback)(() => {
				gate.recheck();
			}, [gate]);
			if (status === AUTH_STATUS.AUTHENTICATED) return null;
			const failure = view.failure;
			const reason = view.snapshot.reason;
			const canRetry = status === AUTH_STATUS.UNREACHABLE;
			/** 表单上方的提示区：失败优先，其次是原因说明。 */
			let notice = null;
			if (failure !== null) notice = (0, react.createElement)("p", {
				className: "dsAuthGateError",
				role: "alert"
			}, tr(failureKey(failure)));
			else if (canRetry) notice = (0, react.createElement)("p", { className: "dsAuthGateNotice" }, tr("unreachableHint"));
			else if (reason === "expired" || reason === "rejected") notice = (0, react.createElement)("p", { className: "dsAuthGateNotice" }, tr("expiredHint"));
			else if (reason === "logout") notice = (0, react.createElement)("p", { className: "dsAuthGateNotice" }, tr("logoutHint"));
			const heading = canRetry ? tr("unreachableTitle") : reason === "expired" || reason === "rejected" ? tr("unauthenticatedTitle") : tr("title");
			/** 校验中：不放表单，避免用户在结论出来前输入凭据。 */
			if (status === AUTH_STATUS.CHECKING && failure === null) return (0, react.createElement)("div", {
				className: "dsAuthGate",
				ref: rootRef,
				role: "dialog",
				"aria-modal": "true"
			}, (0, react.createElement)("div", { className: "dsAuthGatePanel" }, (0, react.createElement)("h1", { className: "dsAuthGateTitle" }, heading), (0, react.createElement)("p", { className: "dsAuthGateSubtitle" }, tr("checking")), (0, react.createElement)("span", {
				className: "dsAuthGateSpinner",
				"aria-hidden": "true"
			})));
			return (0, react.createElement)("div", {
				className: "dsAuthGate",
				ref: rootRef,
				role: "dialog",
				"aria-modal": "true"
			}, (0, react.createElement)("div", { className: "dsAuthGatePanel" }, (0, react.createElement)("h1", { className: "dsAuthGateTitle" }, heading), (0, react.createElement)("p", { className: "dsAuthGateSubtitle" }, tr("subtitle")), notice, (0, react.createElement)("form", {
				onSubmit: submit,
				noValidate: true
			}, field(tr("fieldServer"), serverAddress, setServerAddress, "url", busy, tr("placeholderServer"), "url"), field(tr("fieldUsername"), username, setUsername, "username", busy, void 0, "username"), field(tr("fieldPassword"), password, setPassword, "password", busy, void 0, "current-password"), (0, react.createElement)("button", {
				className: "dsAuthGateSubmit",
				type: "submit",
				disabled: busy
			}, busy ? tr("submitting") : tr("submit"))), canRetry ? (0, react.createElement)("div", { className: "dsAuthGateActions" }, (0, react.createElement)("button", {
				className: "dsAuthGateSecondary",
				type: "button",
				onClick: recheck
			}, tr("retry"))) : null, view.snapshot.serverAddress && view.snapshot.username ? (0, react.createElement)("p", { className: "dsAuthGateMeta" }, `${tr("signedInAs")}: ${view.snapshot.username} · ${view.snapshot.serverAddress}`) : null));
		}
		/**
		* 渲染一个表单字段。
		*
		* @param {string} label - 已翻译的标签文案。
		* @param {string} value - 当前值。
		* @param {(next: string) => void} onChange - 变更回调。
		* @param {string} type - input 类型。
		* @param {boolean} disabled - 是否禁用。
		* @param {string} [placeholder] - 占位文案（仅服务器地址用）。
		* @param {string} [autoComplete] - autocomplete 提示。
		* @returns {object} React 节点。
		*/
		function field(label, value, onChange, type, disabled, placeholder, autoComplete) {
			return (0, react.createElement)("label", { className: "dsAuthGateField" }, (0, react.createElement)("span", { className: "dsAuthGateLabel" }, label), (0, react.createElement)("input", {
				className: "dsAuthGateInput",
				type,
				value,
				disabled,
				placeholder,
				autoComplete,
				spellCheck: false,
				autoCapitalize: "off",
				onChange: (event) => onChange(event.target.value)
			}));
		}
		//#endregion
		//#region dsh-auth-gate/src/client/styles.js
		/**
		* 闸门界面的样式。
		*
		* 两点刻意的选择：
		*
		* 1. **不猜客户端主题变量名**。样式自持（自带 CSS 变量 + `prefers-color-scheme`
		*    回退），所以无论是 web 组合还是桌面组合、无论主题插件怎么改，闸门页都不会
		*    变成白底白字。代价是它不会跟着产品主色走 —— 对一个登录页来说这个代价可以接受。
		* 2. **`position: fixed; inset: 0`**。这一个选择让 overlay 与 root-shadow 两种形态
		*    共用同一份样式：作为浮层时铺满视口，作为整页时同样铺满视口。
		*    `pointer-events` 显式打开，不依赖宿主的 overlay 容器是否给了穿透规则。
		*/
		const STYLE_ID = "dsh-auth-gate-styles";
		const CSS = `
.dsAuthGate {
  --dsag-bg: #ffffff;
  --dsag-fg: #16181d;
  --dsag-muted: #6b7280;
  --dsag-border: rgba(16, 20, 30, 0.12);
  --dsag-field: rgba(16, 20, 30, 0.04);
  --dsag-accent: #2f6bef;
  --dsag-accent-fg: #ffffff;
  --dsag-danger: #c0392b;
  --dsag-danger-bg: rgba(192, 57, 43, 0.08);

  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  pointer-events: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--dsag-fg);
  background: color-mix(in srgb, var(--dsag-bg) 78%, transparent);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
}

@media (prefers-color-scheme: dark) {
  .dsAuthGate {
    --dsag-bg: #14161c;
    --dsag-fg: #f2f4f8;
    --dsag-muted: #9aa3b2;
    --dsag-border: rgba(255, 255, 255, 0.14);
    --dsag-field: rgba(255, 255, 255, 0.06);
    --dsag-accent: #4d84ff;
    --dsag-danger: #ff8a80;
    --dsag-danger-bg: rgba(255, 138, 128, 0.12);
  }
}

.dsAuthGatePanel {
  width: 100%;
  max-width: 420px;
  box-sizing: border-box;
  padding: 28px 28px 24px;
  border: 1px solid var(--dsag-border);
  border-radius: 16px;
  background: var(--dsag-bg);
  box-shadow: 0 24px 60px rgba(8, 12, 24, 0.22);
}

.dsAuthGateTitle {
  margin: 0 0 6px;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.dsAuthGateSubtitle {
  margin: 0 0 20px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsag-muted);
}

.dsAuthGateField {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.dsAuthGateLabel {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsag-muted);
}

.dsAuthGateInput {
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--dsag-border);
  border-radius: 9px;
  background: var(--dsag-field);
  color: inherit;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.dsAuthGateInput:focus {
  border-color: var(--dsag-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsag-accent) 22%, transparent);
}

.dsAuthGateInput:disabled { opacity: 0.6; }

.dsAuthGateSubmit {
  width: 100%;
  height: 40px;
  margin-top: 6px;
  border: none;
  border-radius: 9px;
  background: var(--dsag-accent);
  color: var(--dsag-accent-fg);
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 120ms ease;
}

.dsAuthGateSubmit:disabled { opacity: 0.6; cursor: default; }

.dsAuthGateError {
  margin: 0 0 14px;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--dsag-danger) 35%, transparent);
  background: var(--dsag-danger-bg);
  color: var(--dsag-danger);
  font-size: 13px;
  line-height: 1.5;
}

.dsAuthGateNotice {
  margin: 0 0 14px;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--dsag-border);
  background: var(--dsag-field);
  font-size: 13px;
  line-height: 1.5;
}

.dsAuthGateMeta {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--dsag-border);
  font-size: 12px;
  line-height: 1.7;
  color: var(--dsag-muted);
  word-break: break-all;
}

.dsAuthGateActions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.dsAuthGateSecondary {
  flex: 1;
  height: 36px;
  border: 1px solid var(--dsag-border);
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.dsAuthGateSpinner {
  display: block;
  width: 22px;
  height: 22px;
  margin: 18px auto 4px;
  border: 2px solid var(--dsag-border);
  border-top-color: var(--dsag-accent);
  border-radius: 50%;
  animation: dsAuthGateSpin 720ms linear infinite;
}

@keyframes dsAuthGateSpin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .dsAuthGateSpinner { animation-duration: 2s; }
}

/* ── 侧边栏用户栏（sidebar.footer.action）────────────────────────────────
 * 布局说明：让「插件市场 / 设置齿轮 / 用户栏」在脚部纵排堆叠所需的
 * 不做任何容器布局手术 —— 曾经的两个版本（全局属性选择器版、closest+inline
 * style 版）都与设置页/设置菜单异常相关，2026-09-15 第三次事故后全部移除。
 * 这里只有用户栏自身的样式，全部 .dsAuth 前缀，不可能越界。 */

/* 颜色策略：badge 自带一套文字/图标色（--dsaub-fg / --dsaub-muted），暗色走
 * prefers-color-scheme。曾尝试删掉 color 改为继承宿主，实测出现问题（2026-09-15
 * 用户反馈），已回退到自带调色板方案。自留 --dsaub-hover 为 hover 底色。 */
.dsAuthUserBadge {
  --dsaub-fg: #16181d;
  --dsaub-muted: #6b7280;
  --dsaub-hover: rgba(16, 20, 30, 0.06);

  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  min-height: 36px;
  padding: 7px 8px;
  border-radius: 8px;
  color: var(--dsaub-fg);
  font-size: 14px;
  line-height: 22px;
  font-family: inherit;
}

.dsAuthUserBadge:hover { background: var(--dsaub-hover); }

/* 展开态：宿主行内自然排列（不再用 order 参与容器布局手术） */
.dsAuthUserBadge[data-wide='true'] {
  margin: 2px 0;
}

/* 窄栏收起态：对齐市场入口的圆钮规格（36×36），纵列居成一列圆点 */
.dsAuthUserBadge[data-wide='false'] {
  width: 36px;
  height: 36px;
  min-height: 0;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  margin: 4px 0;
}

@media (prefers-color-scheme: dark) {
  .dsAuthUserBadge {
    --dsaub-fg: #f2f4f8;
    --dsaub-muted: #9aa3b2;
    --dsaub-hover: rgba(255, 255, 255, 0.08);
  }
}

/* 与官方行条目对齐：图标位 16×16（panelRow 的 glyph 规格），行高 36、
 * 左内边距 8、gap 8 —— 用户图标、名字与「插件市场」「设置」的图标同轴。
 * 图标走 currentColor，容器显式给 muted 色（继承宿主方案已回退）。 */
.dsAuthUserBadgeAvatar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--dsaub-muted);
}

.dsAuthUserBadgeName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsAuthUserBadgeExit {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--dsaub-muted);
  padding: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.dsAuthUserBadgeExit:hover:not(:disabled) {
  background: var(--dsaub-hover);
  color: var(--dsaub-fg);
}

.dsAuthUserBadgeExit:disabled { opacity: 0.5; cursor: default; }
`;
		/**
		* 注入样式（幂等）。
		*
		* @returns {() => void} 移除样式的清理函数；若样式已存在则返回空操作
		*          （说明另一个实例已经装了，不该由这个实例拆掉）。
		*/
		function installGateStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.getElementById(STYLE_ID) !== null) return () => {};
			const element = document.createElement("style");
			element.id = STYLE_ID;
			element.textContent = CSS;
			document.head.appendChild(element);
			return () => element.remove();
		}
		//#endregion
		//#region dsh-auth-gate/src/client/user-badge.js
		/**
		* 侧边栏用户栏（`sidebar.footer.action`）。
		*
		* 为什么放这个插件而不是单开一个：它需要的**会话状态真相源**（轮询、用户名、
		* 登出动作）全在闸门控制器里；拆出去的插件只能靠读凭据记录/HTTP 反推同一份
		* 状态，等于管两遍还多一条插件间耦合。将来要长成完整"账户页"再拆不迟。
		*
		* 渲染约定：
		* - 注册进官方 sidebar 声明的 **list** 槽位 `sidebar.footer.action`，渲染位置在
		*   设置齿轮**上方**（脚部就两块：footer.action 在上、settings 在下 —— 官方没有
		*   "齿轮下方"的槽位，这是最接近"设置旁边"的标准扩展点）。
		* - **常驻注册、状态驱动渲染**：未授权时组件返回 null，而不是注册/注销槽位 ——
		*   与闸门页"只注册一次"的哲学一致，杜绝"注销失败留下半死 UI"。
		* - `wide` 由 sidebar 传入（展开/收起态）：收起的窄栏只留头像，名字与退出按钮
		*   不渲染（空间不够，也避免误触）。
		* - **绝不触碰宿主容器**（2026-09-15 第三次事故后的铁律）：无论全局 CSS 还是
		*   inline style，一律不对 `footerActions` / `settingsArea` 等宿主元素做任何
		*   改动（display:contents 的两个版本——全局选择器版、closest+inline 版——
		*   都与设置页/设置菜单异常相关）。插件只渲染自己的子树。
		*
		* 用 `createElement` 而不是 JSX：零构建、零依赖，与 gate-view 同一理由。
		*/
		/**
		* 用户栏组件。
		*
		* @param {object} props - 组合 props。
		* @param {object} props.gate - 闸门控制器（由注册处的 `inject` 注入）。
		* @param {(key: string) => string} [props.t] - locale 命名空间绑定的翻译函数。
		* @param {boolean} [props.wide] - sidebar 展开态（由 sidebar 的 renderSlot 传入）。
		* @returns {object|null} React 节点；未授权时返回 null。
		*/
		function UserBadgeView(props) {
			const gate = props.gate;
			const tr = typeof props.t === "function" ? props.t : (key) => key;
			const wide = props.wide === true;
			const view = (0, react.useSyncExternalStore)(gate.subscribe, gate.getSnapshot, gate.getSnapshot);
			const [busy, setBusy] = (0, react.useState)(false);
			const exit = (0, react.useCallback)(async () => {
				if (busy) return;
				setBusy(true);
				try {
					await gate.logout();
				} finally {
					setBusy(false);
				}
			}, [busy, gate]);
			if (view.snapshot.status !== AUTH_STATUS.AUTHENTICATED) return null;
			const username = view.snapshot.username;
			const shown = typeof username === "string" && username !== "" ? username : "·";
			return (0, react.createElement)("div", {
				className: "dsAuthUserBadge",
				"data-wide": wide ? "true" : "false"
			}, (0, react.createElement)("span", {
				className: "dsAuthUserBadgeAvatar",
				"aria-hidden": "true"
			}, (0, react.createElement)(UserIcon)), wide ? (0, react.createElement)("span", {
				className: "dsAuthUserBadgeName",
				title: shown
			}, shown) : null, wide ? (0, react.createElement)("button", {
				className: "dsAuthUserBadgeExit",
				type: "button",
				title: tr("logout"),
				"aria-label": tr("logout"),
				onClick: () => {
					exit();
				},
				disabled: busy
			}, (0, react.createElement)(ExitIcon)) : null);
		}
		/**
		* 用户图标（16×16，currentColor + 2 线宽，颜色随主题）。
		*/
		function UserIcon() {
			return (0, react.createElement)("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"data-icon": "auth-gate-user",
				"aria-hidden": "true"
			}, (0, react.createElement)("circle", {
				cx: 8,
				cy: 5.25,
				r: 2.6,
				stroke: "currentColor",
				strokeWidth: 2
			}), (0, react.createElement)("path", {
				d: "M2.6 13.5c.55-2.65 2.75-4.1 5.4-4.1s4.85 1.45 5.4 4.1",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round"
			}));
		}
		/** 退出登录图标（门 + 向外箭头，currentColor + 2 线宽）。 */
		function ExitIcon() {
			return (0, react.createElement)("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"data-icon": "auth-gate-exit",
				"aria-hidden": "true"
			}, (0, react.createElement)("path", {
				d: "M6.75 2.5H4.5c-.83 0-1.5.67-1.5 1.5v8c0 .83.67 1.5 1.5 1.5h2.25",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round"
			}), (0, react.createElement)("path", {
				d: "M10.25 5.25 13 8l-2.75 2.75M6.5 8h6.5",
				stroke: "currentColor",
				strokeWidth: 2,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}));
		}
		//#endregion
		//#region dsh-auth-gate/src/client/index.js
		/**
		* Auth Gate — Client 半边。
		*
		* 闸门是**状态驱动**的，不是"加载时挂上就一直在"：
		*
		*   checking / unauthenticated / unreachable  → 注册闸门页（覆盖或遮蔽，见 gateMode）
		*   authenticated                             → 注销闸门页，应用界面出现
		*
		* 注册与注销都收在 `ctx.slots.inject` 返回的那个 disposer 上，所以插件卸载、
		* 槽位被销毁时不会留下悬挂的登录页。
		*
		* ## 闸门形态开关（gateMode）
		*
		* 两种形态用的是同一个组件，差别只在 `resolveGateTarget()` 给出的注册参数：
		*
		*   overlay     → `{ name: 'shell.overlay', id: 'auth-gate', order: -1000 }`
		*   root-shadow → `{ name: 'root', priority: -1 }`
		*
		* 切换形态不改这个文件 —— 改配置即可。两条与 root-shadow 有关的硬约束写在了
		* `resolveGateTarget()` 的文件头注释里（不传 children、不禁用 ui-layout 行），
		* 改这里之前请先读那段。
		*/
		const name = "dsh-auth-gate";
		const inject = ["slots", "locale"];
		/**
		* Client 插件入口。
		*
		* @param {object} ctx - Client Context（已满足 {@link inject}）。
		* @param {object} [rawConfig] - Loader 行上的 `config`（与 Host 同源）。
		*/
		function apply(ctx, rawConfig) {
			const config = normalizeConfig(rawConfig);
			const gate = createGateController({ serverAddress: config.serverAddress });
			const target = resolveGateTarget(config.gateMode);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "auth-gate: dictionaries");
			ctx.effect(() => installGateStyles(), "auth-gate: styles");
			ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "auth-gate-user",
				order: 20,
				locale: NS,
				inject: () => ({ gate })
			}, UserBadgeView)), "auth-gate: sidebar user badge");
			ctx.effect(() => {
				gate.start();
				return () => gate.stop();
			}, "auth-gate: state polling");
			ctx.effect(() => {
				let disposeGate = null;
				const sync = () => {
					const wanted = !gate.isAuthorized();
					if (wanted && disposeGate === null) {
						disposeGate = ctx.slots.inject(target.name, () => ctx.slots.register({
							...target,
							locale: NS,
							inject: () => ({ gate })
						}, AuthGateView));
						return;
					}
					if (!wanted && disposeGate !== null) {
						const drop = disposeGate;
						disposeGate = null;
						drop();
					}
				};
				const unsubscribe = gate.subscribe(sync);
				sync();
				return () => {
					unsubscribe();
					if (disposeGate !== null) {
						disposeGate();
						disposeGate = null;
					}
				};
			}, "auth-gate: login gate");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map