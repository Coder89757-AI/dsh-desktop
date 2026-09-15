/**
 * 验证 `dsh-auth-gate` 是否已经被真实 desktop profile 接纳。
 *
 * 这不是包自检（那是 `verify-auth-gate.mjs`），而是**接线自检**：它读的是
 * `$DSH_HOME/profiles/desktop` 的实际状态，调用的是 desktop 自己的
 * `desktopBundleList` 与 `resolveOverlayPackage`，因此它的结论等同于
 * 应用启动时 `ensureDesktopProfile()` 会得到的结论。
 *
 * 用途：每次改完接线（bundle 列表、包链接、patch 字段）跑一次，
 * 不用启动 GUI 就能知道"这一层会不会被加载"。
 *
 * 用法：node dsh-auth-gate/scripts/verify-profile-wiring.mjs
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 未捕获异常也必须留下输出。本脚本只在末尾统一打印，若中途抛错会「零输出」，
// 看起来像没跑过 —— 那是最糟的失败形态，所以这里先兜住。
const emitReport = (payload) => process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, (error) => {
    emitReport({
      ready: false,
      fatal: String(error?.message ?? error),
      hint: '接线验证脚本自身抛错，profile 可能处于半接线状态',
    })
    process.exit(0)
  })
}

const REPO_ROOT = 'D:/workspace/dsh-desktop'
const DESKTOP_DIR = join(REPO_ROOT, 'dsh-plugin-desktop')
const PLUGIN_DIR = join(REPO_ROOT, 'dsh-auth-gate')
const PLUGIN_NAME = 'dsh-auth-gate'

/** DSH home：优先环境变量，否则落到用户主目录下的 .dsh。 */
const DSH_HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'desktop')
const PROFILE_MANIFEST = join(PROFILE_DIR, 'package.json')

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

/** 让 desktop 的编译产物能在它自己的依赖树里解析依赖。 */
const requireFromDesktop = createRequire(join(DESKTOP_DIR, 'package.json'))
const loadDesktopModule = async (relative) => import(
  pathToFileURL(join(DESKTOP_DIR, relative)).href,
)

// ── 1. 前置：desktop 编译产物与 profile 是否都在 ────────────────────────────
check('desktop lib/ 编译产物存在', existsSync(join(DESKTOP_DIR, 'lib')))
check('desktop lib/profile.js 存在（desktopBundleList 的来源）', existsSync(join(DESKTOP_DIR, 'lib', 'profile.js')))
check(`profile manifest 存在（${PROFILE_MANIFEST}）`, existsSync(PROFILE_MANIFEST))

if (checks.some((entry) => !entry.pass)) {
  // 前置不满足时后续断言没有意义，直接汇报。
  process.stdout.write(`${JSON.stringify({ ready: false, checks }, null, 2)}\n`)
  process.exit(0)
}

// ── 2. desktop 的 bundle 归一化：第三方是否被保留 ───────────────────────────
const { desktopBundleList } = await loadDesktopModule('lib/profile.js')
const manifest = JSON.parse(readFileSync(PROFILE_MANIFEST, 'utf8'))
const declared = manifest?.dsh?.profile?.bundles
check('profile manifest 声明了 dsh.profile.bundles 数组', Array.isArray(declared), declared)

const normalized = desktopBundleList(Array.isArray(declared) ? declared : [])
check(
  'desktopBundleList 保留了 dsh-auth-gate（说明它会被当作第三方 bundle 加载）',
  normalized.includes(PLUGIN_NAME),
  normalized,
)
check(
  'desktopBundleList 把它排在必需 bundle 之后（顺序稳定）',
  normalized.indexOf(PLUGIN_NAME) >= 2,
  normalized.indexOf(PLUGIN_NAME),
)

// ── 3. desktop 的包解析：能否从 profile 找到这个包 ──────────────────────────
// `src/package-overlay.ts` 的 `resolveOverlayPackage` 未从编译产物导出（被内联进
// 内部 chunk），这里按它的判据等价复现：`readCandidate` 只做一件事 —— 用 Node 的
// `findPackageJSON(name, anchorUrl)` 解析，再校验 manifest 的 name 与 packageName
// 一致；`findOverlayPackage` 在其上做 install/profile 双侧择优（version 更高者胜，
// 同版本保 install）。因此下面的断言与 `ensureDesktopProfile()` 的解析结论一致。
const installPackageUrl = pathToFileURL(join(DESKTOP_DIR, 'package.json')).href
const profilePackageUrl = pathToFileURL(PROFILE_MANIFEST).href

/** 等价复现 src/package-overlay.ts:47-88 的 readCandidate。 */
function readCandidate(packageName, packageUrl, source) {
  let manifestPath
  try {
    manifestPath = findPackageJSON(packageName, packageUrl)
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined
    throw error
  }
  if (manifestPath === undefined) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest?.name !== packageName) {
    throw new Error(`package identity is invalid for ${packageName} (${source})`)
  }
  return { packageDir: dirname(manifestPath), manifestPath, source, version: manifest.version }
}

let install
let profile
try {
  install = readCandidate(PLUGIN_NAME, installPackageUrl, 'install')
  profile = readCandidate(PLUGIN_NAME, profilePackageUrl, 'profile')
  check('findPackageJSON 能从 profile 解析到 dsh-auth-gate', profile !== undefined)
} catch (error) {
  check('findPackageJSON 能从 profile 解析到 dsh-auth-gate', false, String(error?.message ?? error))
}

if (profile !== undefined) {
  // `findPackageJSON` 返回的是解析到的路径本身，不会解开 profile 里的链接，
  // 所以这里按 desktop 的 `dependencyClosure` 同款做法取 realpath 再比 —— 它
  // 内部也用 `realpathSync.native` 把 profile 链接还原成真实包目录。
  const resolvedDir = realpathSync.native(profile.packageDir).replace(/\\/gu, '/').toLowerCase()
  const expectedDir = realpathSync.native(PLUGIN_DIR).replace(/\\/gu, '/').toLowerCase()
  check(
    'profile 里这一层最终指向仓库里的这份源码（而不是残留副本）',
    resolvedDir === expectedDir,
    realpathSync.native(profile.packageDir),
  )
  check(
    'profile 顶层这一层确实是链接（desktop 用链接而非拷贝来承载树外包）',
    realpathSync.native(profile.packageDir) !== profile.packageDir,
    profile.packageDir,
  )
  check(
    '安装侧没有同名包（不会与 app.asar 内的副本抢解析）',
    install === undefined,
    install?.packageDir,
  )
}

// ── 4. bundle patch：应用启动时会不会真的读到那个 Loader 行 ─────────────────
const pluginManifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'package.json'), 'utf8'))
const declaredPatch = pluginManifest?.dsh?.bundle?.patch
check('插件声明了 dsh.bundle.patch', typeof declaredPatch === 'string', declaredPatch)

if (typeof declaredPatch === 'string') {
  // app-boot 读 patch 的方式是直接拼路径读文件（不经 package exports）。
  const patchPath = join(PLUGIN_DIR, declaredPatch)
  check(`patch 文件存在（${declaredPatch}）`, existsSync(patchPath))

  if (existsSync(patchPath)) {
    const { parse } = await import(pathToFileURL(requireFromDesktop.resolve('yaml')).href)
    let patchDocument
    try {
      patchDocument = parse(readFileSync(patchPath, 'utf8'))
      check('patch 是合法 YAML', true)
    } catch (error) {
      check('patch 是合法 YAML', false, String(error?.message ?? error))
    }
    if (patchDocument !== undefined) {
      check('patch 顶层是数组（loader patch 层的形态）', Array.isArray(patchDocument))
      const rows = Array.isArray(patchDocument) ? patchDocument.flatMap((entry) => entry?.insert ?? []) : []
      const row = rows.find((candidate) => candidate?.name === PLUGIN_NAME)
      check(`patch 里有一行 name 指向 ${PLUGIN_NAME}`, row !== undefined, rows.map((item) => item?.name))
      check('该行带 id（便于后续按 id 覆盖 config）', typeof row?.id === 'string', row?.id)
      check('该行带 config.gateMode（闸门开关落点）', typeof row?.config?.gateMode === 'string', row?.config?.gateMode)
    }
  }
}

// ── 5. 端到端组合：用 boot() 同款算法算出最终的 entry 列表 ────────────────
// `prepareDesktopProfile()` 的做法是：对每个 selectedBundle 解析出
// `dsh.bundle.patch`、`loadOverlayPatches` 成一层，profile 自己的
// `cordis.patch.yml` 再作为最后一层，最后 `composeEntries` 一次性合成。
// 这里按同一顺序逐步复现，因此拿到的那份条目就等同于应用启动时挂载的条目。
try {
  const appBootEntry = requireFromDesktop.resolve('@deepseek-ai/dsh-app-boot')
  const { composeEntries, loadOverlayPatches } = await import(pathToFileURL(appBootEntry).href)

  const warnings = []
  const layers = []
  for (const packageName of normalized) {
    // 与 profile.ts:575 同款的覆盖解析：安装侧优先，缺失时落到 profile。
    const chosen = readCandidate(packageName, installPackageUrl, 'install')
      ?? readCandidate(packageName, profilePackageUrl, 'profile')
    if (chosen === undefined) {
      warnings.push(`${packageName}: 安装侧与 profile 侧都解析不到`)
      continue
    }
    const bundleManifest = JSON.parse(readFileSync(join(chosen.packageDir, 'package.json'), 'utf8'))
    const declaredPatch = bundleManifest?.dsh?.bundle?.patch
    if (typeof declaredPatch !== 'string' || declaredPatch.length === 0) {
      // desktop 在这里是硬抛错（profile.ts:588），所以这条绝不能只当警告吞掉。
      warnings.push(`${packageName}: 未声明 dsh.bundle.patch —— desktop 会在此抛错`)
      continue
    }
    layers.push(loadOverlayPatches('dsh-plugin-desktop', join(chosen.packageDir, declaredPatch)))
  }

  const profilePatchPath = join(PROFILE_DIR, 'cordis.patch.yml')
  const profilePatches = existsSync(profilePatchPath)
    ? loadOverlayPatches('dsh-plugin-desktop', profilePatchPath)
    : []
  layers.push(profilePatches)

  const composed = composeEntries(layers, (message) => warnings.push(message))
  const gateRow = composed.find((row) => row?.name === PLUGIN_NAME)
  check(
    '最终 entry 列表里存在 dsh-auth-gate 这一行（等同于启动时会挂载的那份）',
    gateRow !== undefined,
    gateRow,
  )
  check('该行没有被任何层禁用', gateRow?.disabled !== true, gateRow?.disabled)

  // ── 一条容易误判的语义：patch 层的 `config` 是**整体替换**，不是深合并。
  // 所以 profile 层只写 serverAddress/allowHttp 两项时，插件自带的
  // gateMode/paths/fields/timeoutMs 会被丢掉，最终行里就只剩下那两项。
  // 这本身不是问题 —— 插件的 `normalizeConfig` 对缺失项有兜底 —— 但兜底一旦
  // 失效，应用启动时就会拿到半截配置。所以这里验证的是"兜底确实成立"。
  const { normalizeConfig } = await import(pathToFileURL(join(PLUGIN_DIR, 'lib', 'constants.js')).href)
  const effective = normalizeConfig(gateRow?.config)
  check(
    '最终 config 经归一化后 gateMode 合法（缺项由 normalizeConfig 兜底）',
    effective.gateMode === 'overlay' || effective.gateMode === 'root-shadow',
    { raw: gateRow?.config, normalized: effective.gateMode },
  )
  check(
    '最终 config 经归一化后 timeoutMs 仍是正数',
    Number.isFinite(effective.timeoutMs) && effective.timeoutMs > 0,
    effective.timeoutMs,
  )
  check(
    '最终 config 经归一化后 paths 四项齐全',
    ['verify', 'login', 'refresh', 'logout'].every(
      (key) => typeof effective.paths?.[key] === 'string' && effective.paths[key] !== '',
    ),
    effective.paths,
  )

  // profile patch 是最后一层。注意查找键是**行 id**（auth-gate）而不是包名 ——
  // patch 的定位口径是行 id，这一点很容易写错（第一版就写成包名，导致误判为"无覆盖"）。
  const override = profilePatches.find((patch) => patch?.id === gateRow?.id)
  if (override?.config !== undefined && typeof override.config === 'object') {
    for (const [key, value] of Object.entries(override.config)) {
      check(`profile patch 的 ${key} 覆盖已生效`, gateRow?.config?.[key] === value, gateRow?.config?.[key])
    }
  } else {
    check('profile patch 未覆盖该行（继续用插件默认值）', true, '无覆盖项')
  }

  check('组合过程没有产生未匹配的 patch 警告', warnings.length === 0, warnings)
} catch (error) {
  check('端到端组合（composeEntries）可执行', false, String(error?.message ?? error))
}

// ── 6. 包入口与 client 入口是否真的存在（Loader 与 client-modules 会去读） ──
// 注意：client 入口必须是**打包产物**（__ModuleLoader__ 工厂注册形态），
// 原始 ESM 源码会让整份 combo 脚本在浏览器里 SyntaxError。形态细节由
// verify-client-bundle.mjs 把关，这里只验「exports["./client"] 指向的文件在」。
const mainEntry = join(PLUGIN_DIR, pluginManifest.main ?? 'lib/index.js')
check(`包主入口存在（${pluginManifest.main}）`, existsSync(mainEntry))
const clientExport = pluginManifest.exports?.['./client']
const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default
check('exports["./client"] 已声明', typeof clientRel === 'string', clientExport)
check(
  `client 产物存在（${clientRel ?? '未声明'}）`,
  typeof clientRel === 'string' && existsSync(join(PLUGIN_DIR, clientRel)),
)

// ── 汇总 ───────────────────────────────────────────────────────────────────
const failed = checks.filter((entry) => !entry.pass)
process.stdout.write(`${JSON.stringify({
  ready: failed.length === 0,
  profile: PROFILE_DIR,
  normalized,
  summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
  checks,
}, null, 2)}\n`)
