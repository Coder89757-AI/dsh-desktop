# 打包与分发指南

本文档说明如何从源码打包 LexFord 桌面应用，以及打包前的品牌配置约定。

## 前置条件

- Node.js `^22.19.0` 或 `>=24.0.0`
- 通过 Corepack 启用根目录固定的 Yarn `4.18.0`：
  ```powershell
  corepack enable
  ```
- 初始化上游子模块并安装依赖（在仓库根目录执行）：
  ```powershell
  git submodule update --init --recursive
  corepack yarn install --immutable
  ```

## 品牌配置

打包品牌由各变体目录下的 `branding/brand.json` 控制（不入库，属本地配置）：

```json
{
  "productName": "LexFord",
  "displayName": "法海问津",
  "windowTitle": "法海问津"
}
```

| 字段 | 用途 | 取值约定 |
| --- | --- | --- |
| `productName` | 打包身份：exe 名、快捷方式、安装目录、产物文件名 | 保持 ASCII、文件系统安全，固定用英文 `LexFord` |
| `displayName` | 运行时显示：托盘 tooltip、应用菜单 | 本地化名称，中文环境用 `法海问津`；缺省时回退到 `productName` |
| `windowTitle` | 窗口标题 | 本地化名称 |

`yarn build` 的第一步（`scripts/apply-branding.mjs`）会把 `brand.json` 投影为 `build/branding.json` 供打包与运行时消费，因此**改完 brand.json 直接打包即可，无需手动执行中间步骤**。

## Windows 打包

在仓库根目录执行（`dsh-plugin-desktop` 为稳定版变体）：

```powershell
# 安装器（NSIS，推荐分发给最终用户）
corepack yarn workspace dsh-plugin-desktop dist:win

# 便携版（ZIP 免安装）
corepack yarn workspace dsh-plugin-desktop dist:win-portable

# 仅打出未封装的 app 目录，用于本地快速验证
corepack yarn workspace dsh-plugin-desktop package:dir
```

beta 变体把 workspace 名换成 `dsh-plugin-desktop-beta`，脚本名相同：

```powershell
corepack yarn workspace dsh-plugin-desktop-beta dist:win
```

### 产物清单

产物输出在对应变体的 `dist/` 目录（以版本 `2.0.10` 为例）：

| 命令 | 产物 |
| --- | --- |
| `dist:win` | `LexFord-2.0.10-x64-Setup.exe` |
| `dist:win-portable` | `LexFord-2.0.10-x64-Portable.zip` |
| `package:dir` | `LexFord-2.0.10-x64/`（win-unpacked 目录） |

安装后的行为：

- 可执行文件、开始菜单快捷方式、安装目录均为 `LexFord`
- 窗口标题、系统托盘 tooltip、应用菜单显示 `法海问津`

## 打包门禁

`dist:win` / `dist:win-portable` 内部会先运行 `check:win-package` 门禁：

1. 构建 `dsh-community-market` 前端
2. `yarn build`（含品牌投影、图标生成）
3. `typecheck` + 打包相关测试套件（`verify-win-installer`、`verify-win-portable` 等）
4. `verify:closure` 运行时闭包校验

门禁全绿后才会产出安装器，整段流程预计耗时数分钟。

## 离线 Python 运行时（beta 变体）

Windows 安装包内置 Python 解释器、`uv` 与 connector 依赖 wheel 闭包，使 AA connector 在纯离线环境也能启动；npm/PyPI 仅在"下载新依赖"时才需要网络。

打包前会自动执行 `fetch:python-runtime`（`scripts/fetch-python-runtime.mjs`）采集三件套到 `build/python-runtime/`，并以 `extraResources` 嵌入安装包：

- `python/` — python-build-standalone 的 install_only CPython 3.12.14（默认 tag 20260901，npmmirror 镜像）；
- `uv/uv.exe` — 优先复用 hoisted 的 `@dataiku/uv-win32-x64` 二进制（与 bridge 的 uv 版本锁死一致）；
- `wheels/` — connector 依赖闭包（`pip download --only-binary :all:`，aliyun 镜像，含 dev 组与跨平台 marker 依赖）。

采集是幂等的：命中 `manifest.json` 即跳过，下载缓存在 `build/python-runtime/.cache/`。

可用的环境旋钮：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `DSH_DESKTOP_PYTHON_RUNTIME=0` | 禁用离线运行时，产出带 `DISABLED` 标记的空目录 | 启用 |
| `DSH_PYTHON_STANDALONE_MIRROR/TAG/VERSION` | CPython 归档镜像 / tag / 版本 | npmmirror / 20260901 / 3.12.14 |
| `DSH_UV_NPM_REGISTRY` / `DSH_UV_VERSION` | uv 后备下载源 | npmmirror / 0.12.0 |
| `DSH_PYPI_INDEX_URL` | wheel 闭包下载源 | aliyun 镜像 |

运行时行为：主进程注入 `UV_PYTHON`、`UV_FIND_LINKS`（及 pip 对应变量），并默认设 `UV_OFFLINE=1`；若需要在应用内联网拉取新依赖，设 `DSH_DESKTOP_PYTHON_ONLINE=1` 启动。开发态运行时根目录取 `DSH_DESKTOP_PYTHON_RUNTIME` 环境变量。

手动刷新闭包（改了 connector 依赖或镜像配置后）：

```powershell
Remove-Item dsh-plugin-desktop-beta\build\python-runtime\wheels -Recurse -Force
corepack yarn workspace dsh-plugin-desktop-beta fetch:python-runtime
```



```powershell
# 完整发布流程（签名、公证等）
corepack yarn workspace dsh-plugin-desktop dist:mac

# 仅打 dmg 用于冒烟验证
corepack yarn workspace dsh-plugin-desktop dist:mac-smoke
```

## 常见问题

- **改了 `brand.json` 但产物名没变**：确认改的是对应变体目录（`dsh-plugin-desktop/branding/` 或 `dsh-plugin-desktop-beta/branding/`）下的文件，且值两端无多余空白。
- **门禁失败**：先单独复现失败项（如 `corepack yarn workspace dsh-plugin-desktop test`），修复后再重新打包；不要绕过门禁直接取中间产物。
- **dist 目录为空**：说明尚未打包成功，从 `dist:win` 的终端输出末尾找第一个报错。
