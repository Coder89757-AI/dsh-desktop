# dsh-auth-gate

打开应用 → 校验授权有效性 → 必要时登录 → 登录成功后才进入系统，并把登录凭据存下来供
MCP 服务与知识库消费。

这是一个**普通 DSH 插件**（只依赖官方契约：`credentials` / `llm` / `tools` / `webServer` /
`slots` / `locale`），因此 CLI、`dsh web`、Desktop 三处都能跑，也不碰任何桌面内部服务。

登录后它还会在**侧边栏底部**（官方 `sidebar.footer.action` 槽位，设置齿轮上方）放一个
用户栏：头像缩写 + 用户名 + 退出按钮（`src/client/user-badge.js`）。侧边栏收起成窄栏时
只显示头像。同样是常驻注册、按授权状态决定渲染。

---

## 它到底挡住了什么

三道闸门同时上，**任一道被绕过仍有另两道**：

| # | 闸门 | 位置 | 强度 |
|---|---|---|---|
| 1 | 登录页挡住界面 | Client：`shell.overlay` 覆盖 或 遮蔽 `root` | 形态 A 中 / 形态 B 强 |
| 2 | 模型调用被短路 | Host：`llm/stream` 不调 `next()`，直接交回一句拒绝理由 | **强** |
| 3 | 工具调用被拒绝 | Host：`ctx.tools.guard()` 单调守卫 | **强** |

**做不到的事**：进程级隔离。插件加载时主进程、Loader、其它插件的 Host 代码都已经跑起来了。
所以"未登录不能进入系统"是**功能等价**，不是隔离。真要进程级，得改桌面启动器，那不属于插件能力。

---

## 快速开始：让它真的被加载

**仓库里有这个目录 ≠ 应用会加载它。** 插件不在仓库的 Yarn workspace 里
（`scripts/verify-layout.mjs` 对 `workspaces` 数组做精确比对，加进去直接让门禁红），
所以它零依赖：自己没有 `node_modules`，Host 半边直接跑 `lib/**` 的 ESM 源码。
但 **Client 半边必须打包**（见下），代价是接入得手动做几步。

### 0. 打包 Client 半边（改过 `src/client/**` 后、以及首次接入前）

```bash
node dsh-auth-gate/scripts/build-client.mjs
```

**为什么 Client 半边必须打包，而 Host 半边不用？** 两半的加载方式完全不同：

- **Host 半边**是 Node 直接 `import` 的 ESM 源码，`lib/*.js` 就是源码也是产物；
- **Client 半边**不是被"加载"的，而是 desktop 的 `client-modules` 把
  `exports["./client"]` 指向的**文件字节**当**经典脚本**拼进 combo 端点
  （`/plugins/??<pkg>/client.js,…&rev=…`）。浏览器那份产物必须自己调用
  `window.__ModuleLoader__.load({id, factory})` 注册工厂，模块体全部包在
  factory 闭包里惰性执行。

交一份原始 ESM 源码上去会怎样？浏览器解析整个 combo 时顶层 `import` 直接
SyntaxError → **一个工厂都注册不上**，而报错指向 combo 里第一个被 await 的条目
（通常是无关的 `@deepseek-ai/dsh-client-hmr`）："bundle … loaded without
registering … via __ModuleLoader__.load"。症状与真凶完全无关，这是本次踩过的坑。

产物包装契约与 `dsh-community-market/tsdown.config.ts` 同构（banner/intro/footer
三段），打包用 `scripts/build-client.mjs`（从 market/desktop 的 `node_modules` 借
rolldown —— 本包不在 workspace，拿不到自己的构建器）。源码在 `src/client/`，
产物 `lib/client.js`（含 `.map`）**提交进仓库** —— 打包后的应用没有构建环境，
产物必须在。

改了 `src/client/**` 或 `lib/constants.js` / `lib/gate-mode.js`（它们会被内联进
client 产物）却忘了重新打包，`verify-client-bundle.mjs` 会用"源码比产物新"报过期。

### 1. 让 profile 能解析到这个包

profile 的包解析在 `dsh-plugin-desktop/src/package-overlay.ts`：它用 Node 的
`findPackageJSON(name, profilePackageUrl)` 在**你的 profile 目录**里找包，所以包必须
出现在那里。

```bash
# Windows：junction 不需要管理员权限，也不需要开发者模式
node -e "require('fs').symlinkSync(
  'D:/workspace/dsh-desktop/dsh-auth-gate',
  process.env.USERPROFILE + '/.dsh/profiles/desktop/node_modules/dsh-auth-gate',
  'junction')"

# macOS / Linux
ln -s /absolute/path/to/dsh-auth-gate ~/.dsh/profiles/desktop/node_modules/dsh-auth-gate
```

**不要**改 profile 的 `dependencies`，也**不要**跑 `pnpm install`：

- `desktopBundleList()` 只读 `dsh.profile.bundles`，不读 `dependencies`；
- `healProfileModuleFallback()` 的清理只针对它自己托管的
  `.dsh-module-fallback/node_modules` 里的名字，手工建的链接它不碰；
- 动 `dependencies` 反而可能让 pnpm 认为 lockfile 过期而触发整树重装。

### 2. 把包名写进 `dsh.profile.bundles`

编辑 `~/.dsh/profiles/desktop/package.json`：

```json
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "…其它第三方…",
      "dsh-auth-gate"
    ]
  }
}
```

顺序不敏感：`desktopBundleList()` 会归一到「必需 bundle 在前、第三方保持原序」。

### 3. 重启应用

profile **只在启动时读取一次**。已经开着的实例不会加载新插件 —— 这是最容易误判的地方
（"我明明接好了，怎么什么都没有"）。

### 验证接线（不必启动 GUI）

```bash
node dsh-auth-gate/scripts/verify-profile-wiring.mjs
```

它读**你机器上真实的 profile 状态**，并调用 desktop 自己的 `desktopBundleList()` 与
`composeEntries()` 复现一次 profile 组合，因此结论等同于应用启动时会得到的结论 ——
包括"最终那一行长什么样、config 是什么"。

### 回滚

```bash
# 1) 从 dsh.profile.bundles 里删掉 "dsh-auth-gate"
# 2) 删掉链接
rm ~/.dsh/profiles/desktop/node_modules/dsh-auth-gate
```

Loader 行由包内的 `cordis.patch.yml` 提供，配置写在同一份文件里（见下）。

---

## 配置

```yaml
- insert:
    - id: auth-gate
      name: dsh-auth-gate
      config:
        gateMode: overlay        # ← 闸门形态开关，见下
        serverAddress: ''        # 授权服务器；留空则必须由用户在登录页填写
        allowHttp: false         # 只允许 https；内网 http 需显式打开
        paths:                   # 协议不匹配时**只改这里，不改代码**
          verify: /api/auth/verify
          login: /api/auth/login
          refresh: /api/auth/refresh
          logout: /api/auth/logout
        fields:                  # 响应字段映射
          token: token
          refreshToken: refreshToken
          expiresIn: expiresIn
          user: user
        timeoutMs: 5000          # 服务器触达超时
```

---

### 陷阱：patch 层的 `config` 是**整体替换**，不是深合并

在 profile 的 `cordis.patch.yml` 里按 id 覆盖时：

```yaml
- id: auth-gate          # ← 定位口径是**行 id**，不是包名
  config:
    serverAddress: http://127.0.0.1:8787
    allowHttp: true
```

这一行的 `config` 会被**整个替换**成这两项 —— 插件自带的 `gateMode` / `paths` /
`fields` / `timeoutMs` 全部消失（实测确认：`composeEntries()` 出来的行里只剩那两项）。

功能上不会坏：`normalizeConfig()` 对缺失项逐一兜底（`gateMode` 回 `overlay`、超时回
`5000`、`paths` / `fields` 用默认）。但覆盖时**把要用的项写全**更不容易误判。
`verify-profile-wiring.mjs` 对"兜底确实成立"有直接断言。

---

## 本地实测（假授权服务器）

真实授权服务器还不存在，而闸门是 fail-closed 的（连不上就阻断），所以要走通
「登录 → 进系统」这条路径需要一台能连的服务器。仓库里带了一台：

```bash
node dsh-auth-gate/scripts/mock-auth-server.mjs 8787
# 凭证 demo / demo；access token 900s，refresh token 7d
```

它按默认协议实现四个端点（含滚动刷新：旧 refresh token 用一次即作废），只监听回环地址。
配合上面那段 profile patch 把闸门指向 `http://127.0.0.1:8787` 并 `allowHttp: true`，
重启应用即可看到登录页 → 输入 `demo` / `demo` → 进入系统。

⚠️ **闸门是 fail-closed 的：假服务器没在跑时，应用会被拦在登录页。** 这是设计行为、
不是故障 —— 它恰好也是"服务器不可达即阻断"这条策略的现成演示。要彻底解除拦截，
按「回滚」把插件从 `dsh.profile.bundles` 里去掉。

---

## 闸门形态开关（`gateMode`）

两种形态用的是**同一个登录页组件**，差别只在注册到哪个槽位。切换形态不改任何代码。

| | `overlay`（默认） | `root-shadow` |
|---|---|---|
| 注册目标 | `shell.overlay`（上游推荐） | `root` |
| 注册参数 | `{ id: 'auth-gate', order: -1000 }` | `{ priority: -1 }` |
| 视觉 | 登录页覆盖在应用框架之上 | 整页只有登录页 |
| 强度 | 中 —— 框架仍在后台挂载，全局快捷键/命令面板理论上可被键盘触达 | 强 —— 框架组件根本不挂载 |
| 副作用面 | 小 | 有（见下） |

### 为什么默认 `overlay`

框架在后台挂载带来的键盘旁路是**理论上**的风险，而两个 Host 闸门（`llm/stream` +
`tools.guard`）已经保证了即使键盘被绕过、模型与工具仍然是拒的。换句话说，`overlay`
的弱点被 Host 层兜住了，而 `root-shadow` 的副作用面目前**只能在真实窗口里验**
（本机 GUI 启动卡在一个已挂起的 `ERR_FAILED`，尚未验证）。

按证据选：能验收的那个当默认。等 GUI 能起来了，实测 `root-shadow` 的副作用面再切。

### `root-shadow` 的两条硬约束（改之前必读）

1. **绝不传 `children`**。`ui-layout` 已经声明了 `sidebar` / `main` / `rightbar` /
   `shell.overlay` 四个子槽位，而 `SlotCore.register` 对"已声明的子槽位"直接抛错。
   桌面的 `advanced-shell.ts` 能传 children 是因为它**先禁用了 `ui-layout` 行**，
   第三方插件付不起这个代价。
2. **不要禁用 `ui-layout` 行**。它的 `apply()` 里除了注册 root 还提供 `ctx.layout` 服务、
   `panelInfo` hook、`retainMainPanels` 订阅。禁用它 = 静默丢服务。
   遮蔽只能遮蔽**渲染**，不能遮蔽**服务** —— 所以用 `priority: -1` 让组件不渲染，
   那行本身照常运行。

这两条都写在了 `lib/gate-mode.js` 的文件头注释里。

---

## 服务端要提供什么

插件按下面的约定调用服务端（路径与字段都可配）：

| 端点 | 方法 | 入参 | 期望响应 |
|---|---|---|---|
| `paths.login` | POST | `{username, password}` | `{token, refreshToken, expiresIn, user}` |
| `paths.refresh` | POST | `{refreshToken}` | 同上（`refreshToken` 可省略，省略则保留旧的） |
| `paths.logout` | POST | — （带 `Authorization: Bearer <access>`） | 任意 2xx |

**`refreshToken` 是硬要求。** 因为 access token 只在内存（见下），重启后会丢；没有 refresh
机制的话每次重启都要用户重新输密码。登录响应里没有 `refreshToken` 时插件会记一条 warn 日志。

`paths.verify` 目前**没有被启动路径使用**（续期成功即视为授权有效），保留给运行期复查。

### 离线策略

**服务器不可达即阻断，不进入应用**（应用级，非进程级）。

- 不只看本地 `expiresAt`，每次启动都触达服务端。
- 连不上时状态是 `unreachable`，与"凭据失效"（`unauthenticated`）**分开**，
  因为两者的用户引导完全不同（检查网络 / 重新登录）。
- 连不上时**保留本地记录** —— 服务器恢复后下次启动自动进去，不需要重输密码。
- 代价（必须让运维知道）：内网故障或服务器维护期间，**所有人都进不去**。服务器是硬依赖。

---

## 安全边界

### 凭据怎么存（方案 C）

落盘的**只有 refresh token**，access token 只活在内存里。

原因不是洁癖，是实测出来的两条事实：

1. 落盘位置是 `$DSH_HOME/.credentials.yaml`，**纯文本 YAML**，写入未传 mode
   （实测 `mode 666`），全程没有 `crypto`/`safeStorage` 调用。
2. **记录空间没有身份隔离**：`readRecord` 不接受任何调用方身份参数，`listRecords()`
   列出全部 —— 任何一个已安装的插件都能读到这条记录。所以 `auth-gate` 这个 scope
   只是**命名**，不是访问边界。

能真正依赖的防护是**短有效期 + refresh 轮换**。把 access token 的暴露窗口压到进程
生命周期内，是当前架构下能拿到的最好结果。桌面侧加密存储（`safeStorage` 提供方）
是后续排期项。

**永远不落盘/不记日志/不回传前端的东西**：密码、access token。密码只作为局部变量活在一次
交换里；`/api/auth-gate/*` 的任何响应都不含 token（与上游 `CredentialsController` 的
`no method here returns one` 立场一致）。

自检脚本对这条有直接断言：落盘文件里搜不到 access token、搜不到密码。

### 刻意不做的三件事

- **不屏蔽私网/回环 IP**。授权服务器本来就大概率在内网 —— 禁私网等于把插件废掉。
  "跳到任意主机"由"不跟随重定向 + scheme 白名单"覆盖。
- **不提供任何跳过 TLS 校验的开关**（`rejectUnauthorized:false` / `--insecure` /
  `strict-ssl=false`）。证书有问题就去修证书，哪怕只是测试环境。
- **不回显服务端原始报文**。服务端报错常带堆栈、内网 IP、甚至回显的请求体；
  插件只回一个稳定原因码，文案在客户端按码解析。

### 本机端点

`/api/auth-gate/*` 只接受 loopback 来源（校验 `remoteAddress` **和** `Host` 头）。
后者是防 DNS rebinding 的第二道；前端同源 `fetch` 会自动带正确的 `Host`，不受影响。

---

## 消费方契约（MCP / 知识库怎么拿 token）

**不要从配置文件里读 token，也不要缓存它。**

```js
// 需要 refresh token 的消费方（知识库等）
import { credentialKey } from '@deepseek-ai/dsh-credentials'
const record = await ctx.credentials.readRecord(credentialKey('auth-gate', 'session'))
// record.kind === 'grant' → record.payload.refreshToken

// 需要 access token 的消费方 → 走同源 HTTP（token 不进任何响应）
const state = await (await fetch('/api/auth-gate/state')).json()
```

官方对凭据消费方的要求是**每次操作重新读、不得跨操作缓存** —— 这正是"换了凭据不用重启"
的机制，请照做。

MCP 侧的 token 注入**不要**把 token 写进 MCP 行的配置里：`ctx.loader.update()` 会把它
持久化到 profile 的 cordis YAML。正确做法是在插件自己的 fiber 内实例化 MCP 客户端
（`ctx.plugin(mcpClientModule, { ...headers })`），让配置从不落盘。

---

## 自检

三个脚本都是 headless、秒级，不需要 GUI、API key 或真实服务器。

### 产物自检（防"client 产物没打包/过期/形态不对"）

```bash
node dsh-auth-gate/scripts/verify-client-bundle.mjs
```

它在 `vm` 里**真实模拟浏览器的加载协议**：把 `lib/client.js` 当经典脚本编译（顶层
ESM 语法在这里直接炸出 SyntaxError）、在假 `__ModuleLoader__` 环境下执行并断言恰好
注册出 id = 包名的一个工厂、再调用工厂**真实物化**拿到 `apply` / `inject` / `name`。
这是能把本次事故在发布前拦下来的那道检查。

### 包自检（不依赖你的环境）

```bash
node dsh-auth-gate/scripts/verify-auth-gate.mjs
```

全程在临时 `DSH_HOME` 下进行，不触碰真实的 `~/.dsh`（`KEEP_PROBE_HOME=1` 可保留）。它会：

1. 跑一批纯逻辑断言（配置归一化、形态映射、端点安全约束、字段抽取、状态机语义）；
2. 起一个**假授权服务器**，再 boot 一个最小 Host（credentials + webserver + llm + 本插件），
   走完整链路：无记录启动 → 伪造 Host 被拒 → 密码错误 → 登录成功 → **检查落盘里只有
   refresh token** → **llm 闸门短路** → 授权后放行 → 登出 → 重启续期自动进入 → 服务器
   不可达被阻断。

### 接线自检（读这台机器上真实的 profile）

```bash
node dsh-auth-gate/scripts/verify-profile-wiring.mjs
```

它回答的是"这台机器上的应用到底会不会加载它"：包能否从 profile 解析到、
`dsh.profile.bundles` 是否保留了它、`dsh.bundle.patch` 是否被读到，以及用 desktop 自己的
`composeEntries()` 算出的**最终那一行**长什么样、config 是不是预期的。二者互补 ——
前者证明插件本身对，后者证明接线对。

---

## 已知未验证项

诚实清单 —— 这些**没有**被验证过，别当成已验收：

| 项 | 为什么没验 |
|---|---|
| `root-shadow` 形态的副作用面 | 需要真实 GUI 窗口；本机启动卡在已挂起的 `ERR_FAILED` |
| `overlay` 形态下的键盘旁路是否真能触发 | 同上 |
| `tools.guard` 的端到端拒绝 | 只有契约级断言；真跑需要构造一次工具执行 |
| 运行期间（非启动期）服务器失联是否熔断 | **未决项**，当前决策只覆盖启动期 |

上线前建议至少补上 `root-shadow` 与键盘旁路两项的实测。
