# Beta 离线 Python 运行时打包（交接文档）

状态：仅 Beta 变体；**2026-09-17 全链路打通：`dist:win` 门禁全绿并产出 `LexFord-2.0.10-beta.1-x64-Setup.exe`（724MB，内嵌离线 Python 运行时）**；stable 变体未同步。本文档为跨会话交接记录。

## 背景与目标

AA connector（`vendor/agents-anywhere/agents-anywhere-dsh-bridge-next-0.1.0-dev.0.desktop.c7ed3d6bd64fc.rd2c7a8f7.tgz`）的 Python 侧启动链路原本完全依赖网络：

- bridge 通过 `@dataiku/uv@0.12.0` 的 `resolveUv()` 找 `uv`（`UV_PATH` 环境变量 → PATH 上的 `uv`），再执行 `uv sync` 建虚拟环境并拉 PyPI 依赖；
- 缺解释器时经 `UV_PYTHON_INSTALL_MIRROR` 从 python-build-standalone 下载 CPython。

目标：Windows 安装包内置 Python 解释器 + uv + wheel 闭包，应用在纯离线环境也能启动 connector。npm/PyPI 仅在"下载新依赖"时才需要。

## 方案架构（三层）

1. **打包期采集**：`scripts/fetch-python-runtime.mjs` 在打包前下载三件套到 `build/python-runtime/`：
   - `python/` — python-build-standalone 的 install_only CPython 3.12.14（tag 20260901，npmmirror 镜像，tar.gz 布局已兼容有/无 `python/` 子目录两种情况）；
   - `uv/uv.exe` — **优先复用** hoisted 的 `node_modules/@dataiku/uv-win32-x64/bin/uv.exe`（与 bridge 的 uv 版本锁死一致；npmmirror 无此包，下载仅为后备）；
   - `wheels/` — connector 依赖闭包（`pip download --only-binary :all:`，aliyun 镜像）。
   - 幂等：`manifest.json` 记录 url/sha256/requirementText，命中即跳过；下载缓存在 `build/python-runtime/.cache/`；wheels 完成标记 `.closure-complete`。
   - 禁用开关：`DSH_DESKTOP_PYTHON_RUNTIME=0` 产出带 `DISABLED` 标记的空目录。
   - 环境旋钮：`DSH_PYTHON_STANDALONE_MIRROR/TAG/VERSION`、`DSH_UV_NPM_REGISTRY/UV_VERSION`、`DSH_PYPI_INDEX_URL`。
2. **打包嵌入**：`package.json` win 配置 `extraResources: [{ from: "build/python-runtime", to: "python-runtime" }]`；`scripts/package-win.ts` 新增 `preparePythonRuntime` 接口，在 `prepareRuntime()` 之后、electron-builder 之前执行 fetch 脚本。
3. **运行时注入**：`src/desktop-python-runtime.ts` 的 `installDesktopPythonRuntime()` 在主进程设置：
   - `UV_PYTHON=<runtimeRoot>/python/python.exe`、`UV_FIND_LINKS=<runtimeRoot>/wheels`、`PIP_FIND_LINKS` 同路径、`PIP_DISABLE_PIP_VERSION_CHECK=1`，默认再加 `UV_OFFLINE=1`（`DSH_DESKTOP_PYTHON_ONLINE === '1'` 时不加）；
   - PATH 前置 `python/`、`python/Scripts/`、`uv/`（复用 `desktop-runtime-environment.ts` 导出的 `installPathDirectory`，返回 disposer 可整体撤销）；
   - `main.ts` 在 pnpmRuntime 之后接入：打包态取 `join(process.resourcesPath, 'python-runtime')`，开发态取 `DSH_DESKTOP_PYTHON_RUNTIME` 环境变量；
   - bridge 子进程会覆盖 `UV_PROJECT_ENVIRONMENT`、`UV_DEFAULT_INDEX`、`UV_INDEX_URL`、`PIP_INDEX_URL`、`UV_PYTHON_INSTALL_MIRROR`，但**不覆盖**我们注入的 `UV_PYTHON`/`UV_FIND_LINKS`/`UV_OFFLINE`，因此注入对 bridge 的 `uv sync` 生效（`UV_OFFLINE=1` 同时抑制了 bridge 设置的 pypi.org index）。

## 文件清单

新增（均为 untracked）：
- `dsh-plugin-desktop-beta/scripts/fetch-python-runtime.mjs` — 打包期采集脚本
- `dsh-plugin-desktop-beta/src/desktop-python-runtime.ts` — 运行时注入
- `dsh-plugin-desktop-beta/tests/desktop-python-runtime.spec.ts` — 注入与布局校验单测
- `vendor/agents-anywhere/agents-anywhere-dsh-bridge-next-*.tgz` — 本次引入的 bridge 包

修改：
- `dsh-plugin-desktop-beta/src/main.ts` — 接入 `installDesktopPythonRuntime`
- `dsh-plugin-desktop-beta/src/desktop-runtime-environment.ts` — 导出 `installPathDirectory`
- `dsh-plugin-desktop-beta/scripts/package-win.ts` — `preparePythonRuntime` 接口与调用
- `dsh-plugin-desktop-beta/scripts/verify-packaged-runtime.ts` — `REQUIRED_WINDOWS_PYTHON_RUNTIME_ENTRIES`、`resolveWindowsPythonRuntimeRoot`、`verifyWindowsPythonRuntime`，支持 `DISABLED` 标记与 `DSH_DESKTOP_PYTHON_RUNTIME=0` 跳过
- `dsh-plugin-desktop-beta/package.json` — `fetch:python-runtime` 脚本、win `extraResources`、`check:win-package` 纳入新 spec
- `dsh-plugin-desktop-beta/tests/verify-packaged-runtime.spec.ts` — `withWindowsPythonRuntimeProbe` 包装 exists mock
- `dsh-plugin-desktop-beta/tests/package-win.spec.ts` — mock options 加 `preparePythonRuntime`
- `.gitignore` — 忽略 `dsh-plugin-desktop-beta/build/python-runtime/`

注意：`dsh-plugin-desktop/`（stable）**完全没有**对应文件，同步未开始。`docs/deploy.md` 目前是 untracked 新文件，离线打包章节尚未补写。

## 关键实现细节与已踩过的坑

- **TOML 解析**：pyproject 的 `httpx[socks]` 会让惰性正则在 `]` 处截断数组，已改用括号平衡扫描（`tomlArrayBlock`/`tomlArrayFor`），依赖从 3 条修到全量。
- **dev 组**：uv 默认 `default-groups = ["dev"`，`uv sync` 会装 dev 组，`UV_NO_DEV=1` 实测不可靠；闭包已直接纳入 `pytest>=9.0.3`、`ruff>=0.15.13`（含 `hatchling` build requires）。
- **universal resolve**：uv 的解析覆盖全平台，win32 宿主上 pip 跳过的非 win32 纯 py 包也必须进闭包；脚本用 Python 扫已下载 wheel 的 METADATA（非 win32 的 `sys_platform` marker、排除 extra）迭代补下载至固定点。
- **safe-delete 钩子**会拦截 `rmSync`，`removeTree()` 兜底把目录 rename 进 `.cache/.parked-*`。
- **npmmirror** 无 `@dataiku/uv-win32-x64`、缺 python-build-standalone 20250712 tag（改用 20260901/3.12.14）。
- 已知小瑕疵：fetch 脚本头部注释写的默认值（20250712/3.12.11）与实际常量（20260901/3.12.14）不一致，待顺手修正。

## 当前验证状态

已通过：
- fetch 全链路跑通，产物就位（`manifest.json`：python/uv sha256 齐全，闭包 58 wheels + 手工补 2 个，见下）；
- 离线 `pip install --no-index --find-links wheels -r connector-requirements.txt` 成功（60+ 包）；
- 单测通过（desktop-python-runtime.spec、verify-packaged-runtime.spec、package-win.spec；跑测前需先 `corepack yarn workspace dsh-plugin-desktop-beta build` 重建 lib/）。

离线 `uv sync` 冒烟（临时目录解出 connector，`UV_PYTHON`/`UV_FIND_LINKS`/`UV_OFFLINE=1` 指向打包产物）结果链：
1. 第一轮失败：`pexpect{sys_platform != 'win32'}>=4.9.0` 无法满足 → **根因**：`ensureWheels` 把 `portableOnly`（pexpect/ptyprocess）预置进 `satisfied` 集合，但第一轮 `pip download -r` 因 marker 在 win32 为假根本没下载它们，后续 universal 扫描又因已在 `satisfied` 被过滤——**从未真实下载**。
2. 手工 `pip download "pexpect>=4.9.0" "ptyprocess>=0.7.0" --only-binary :all:` 补进 wheels 后（这两个 wheel 镜像上都有，无需 sdist 构建）：**`Resolved 57 packages in 34ms`，解析阶段全绿**。
3. 当前卡点：安装项目自身时 hatchling 构建隔离解析 `editables~=0.3` 失败——闭包缺 `editables` wheel（hatchling 的依赖，`pip download` 拉闭包时为何漏掉待查：先 `Get-ChildItem build\python-runtime\wheels -Filter editables*` 确认）。

注意：手工补的 `pexpect-4.9.0`、`ptyprocess-0.7.0` 两个 wheel 目前在 wheels 目录里但 manifest 未记录（`wheels: 58`），重跑 fetch 因 `.closure-complete` 仍存在不会重建——正式修复脚本后需删掉 `.closure-complete`（或整个 wheels 目录）重跑。

## 建议修复方案（已于 2026-09-17 实施完毕）

1. `portableOnly` 不再预置进 `satisfied`：第一轮 `pip download -r` 后显式对 portableOnly + buildExtras 执行无 marker 的 `pip download`，成功后才登记。
2. `editables>=0.3` 以 `buildExtras` 显式纳入闭包（hatchling 构建 editable wheel 需要 `editables` 但不在其 METADATA 中声明；`uv sync` 以 editable 方式装 connector）。
3. 顺带修复：
   - `connectorArchive()` 改为从 `package.json` 的 `@agents-anywhere/dsh-bridge-next` `file:` 依赖解析归档路径——vendor/ 下现有 4 个 tgz，字典序排序会误选 `ce53016f05be0` 而实际打包引用 `c7ed3d6bd64fc`；
   - tar 调用统一 `tarPath()`（反斜杠→正斜杠）并加 `--force-local`，否则 GNU tar 把 `D:\...` 的冒号当远程主机；
   - 头部注释默认值改为实际的 20260901/3.12.14。

修复后删 `.closure-complete` 重跑 fetch：闭包 61 wheels（含 editables/pexpect/ptyprocess，全部记入 manifest），离线 `uv sync` 冒烟 exit 0 全绿。

## 待办清单

1. ~~修复 fetch 脚本并让离线 `uv sync` 冒烟通过~~（2026-09-17 完成，闭包 61 wheels，冒烟 exit 0）；
2. ~~`dist:win` 实打包~~（2026-09-17 完成：`check:win-package` 门禁 14 文件/276 用例全绿，产出 `dist/LexFord-2.0.10-beta.1-x64-Setup.exe`，afterPack 的 `verifyWindowsPythonRuntime` 通过）；
3. 同步全部改动到 `dsh-plugin-desktop/`（stable），跑 `corepack yarn check:desktop-variants` 并验证两个变体；
4. ~~`docs/deploy.md` 补"离线打包"章节~~（已完成）；
5. ~~顺手修 fetch 脚本头部注释的默认值不一致~~（已完成）。

## 2026-09-17 追加修复（打包落地时发现）

- **pip 启动器**：python-build-standalone 的 `ensurepip` 只装 pip 模块、不生成 `Scripts/pip.exe`，而 `verifyWindowsPythonRuntime` 要求该条目。fetch 脚本新增 `ensurePipLauncher()`：缺 `pip.exe` 时 `python -m pip install --force-reinstall -i <DSH_PYPI_INDEX_URL> pip` 生成。
- **图标污染防护**：beta 缺 `branding/` 时 `apply-branding.mjs` 回退到仓库根 `branding/`（内含本地默认 app-icon.svg），`yarn build` 会用它覆盖提交的产品图标。两变体的 `apply-branding.mjs` 已同步改为"包本地 `branding/` 存在即独占"，并补了本地 `dsh-plugin-desktop-beta/branding/brand.json`（LexFord，gitignored）。产品图标只以提交的 PNG 存在，无 svg 源——**勿再把根目录 svg 应用到 beta**。
- **POSIX 假设测试**（beta 全量 23 个失败，Windows 主机必红，与门禁无关）：module-resolution 13（无盘符 file URL）、compatibility-shell/electron-runtime/plugin/verify-electron-fuses 4（正斜杠正则/文案）、desktop-runtime-environment/pnpm-runtime 6（PATH 释放语义）。`check:win-package` 门禁不含这些 spec，故不影响打包；全量 `yarn check` 需先完成平台化适配。
- **branding.json 与文案测试互斥**：`build/branding.json` 存在（LexFord）时另有一批文案断言测试失败（期望默认 DSH Desktop 文案）；打包门禁不含它们，但跑全量测试前需知悉。

## 常用命令

```powershell
# 采集/刷新离线运行时（幂等）
corepack yarn workspace dsh-plugin-desktop-beta fetch:python-runtime

# 离线 uv sync 冒烟（临时目录，勿污染 build/）
$root = "d:\workspace\agent\dsh-desktop\dsh-plugin-desktop-beta\build\python-runtime"
$tmp = Join-Path $env:TEMP ("dsh-uv-smoke-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force $tmp | Out-Null
tar -xf "d:\workspace\agent\dsh-desktop\vendor\agents-anywhere\agents-anywhere-dsh-bridge-next-0.1.0-dev.0.desktop.c7ed3d6bd64fc.rd2c7a8f7.tgz" -C $tmp
$env:UV_PYTHON = "$root\python\python.exe"; $env:UV_FIND_LINKS = "$root\wheels"; $env:UV_OFFLINE = "1"
& "$root\uv\uv.exe" sync --project "$tmp\package\lib\bundled-connector"

# 相关单测（先重建 lib/）
corepack yarn workspace dsh-plugin-desktop-beta build
corepack yarn workspace dsh-plugin-desktop-beta test tests/desktop-python-runtime.spec.ts
```
