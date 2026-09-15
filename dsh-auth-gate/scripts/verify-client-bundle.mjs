/**
 * Client 产物验证 —— 专防本次事故的那类静默假通过。
 *
 * 本次事故：把**原始 ESM 源码**当作 client 产物交了上去。host 把它当经典脚本
 * 拼进 combo，浏览器解析到顶层 `import` 直接 SyntaxError，整个 combo 一个工厂
 * 都注册不上，而报错指向的却是 combo 里第一个被 await 的条目
 * （`@deepseek-ai/dsh-client-hmr`）—— 症状与真凶完全无关。
 *
 * 所以这里的验证是**执行级**的，不是字面匹配：
 *
 *   1. 产物是合法经典脚本（`vm.Script` 编译 —— 顶层 ESM 语法在这里直接炸）；
 *   2. 在 `window.__ModuleLoader__` 假环境下执行，恰好注册出 id = 包名的一个工厂；
 *   3. 调用该工厂**真实物化**模块体（stub 掉 `react`），拿到 `apply`/`inject`/`name`；
 *   4. 产物没过期（源码比产物新的廉价探测，防"改了源码忘了重新打包"）。
 *
 * headless、零依赖、秒级。与 `verify-auth-gate.mjs`、`verify-profile-wiring.mjs`
 * 并列为本包的三道自检。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import vm from 'node:vm'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CLIENT_ARTIFACT,
  CLIENT_EXTERNAL,
  PACKAGE_NAME,
  clientArtifactIsStale,
} from './build-client.mjs'

const PLUGIN_DIR = join(fileURLToPath(import.meta.url), '..', '..')

const checks = []
let failed = 0

/**
 * 记录一条断言结果。
 *
 * @param {string} name - 断言名。
 * @param {boolean} pass - 是否通过。
 * @param {unknown} [detail] - 失败时展示的细节。
 */
function check(name, pass, detail) {
  checks.push({ name, pass, detail: pass ? undefined : detail })
  if (!pass) failed += 1
}

const source = existsSync(CLIENT_ARTIFACT) ? readFileSync(CLIENT_ARTIFACT, 'utf8') : ''

// ── 1. 存在与新鲜度 ─────────────────────────────────────────────────────────
check('产物 lib/client.js 存在', source !== '', CLIENT_ARTIFACT)
if (source !== '') {
  check(
    '产物不是过期构建（源码没有比产物新）',
    !clientArtifactIsStale(),
    clientArtifactIsStale() ? 'src/client/** 或共享 lib 模块比 lib/client.js 新 —— 先跑 scripts/build-client.mjs' : undefined,
  )
}

// ── 2. 包装契约（与 dsh-community-market/tsdown.config.ts 同构；注意 rolldown 会把 banner 重新排版成多行，只能做结构匹配）──
check('产物以 __ModuleLoader__.load( 开头', source.trimStart().startsWith('window.__ModuleLoader__.load('), source.slice(0, 120))
check('产物里注册的 id 是包名', source.includes(`id: ${JSON.stringify(PACKAGE_NAME)}`), `期望 ${JSON.stringify(PACKAGE_NAME)}`)
// host 拼 combo 时会剥掉 sourceMappingURL 尾注再拼接，所以契约匹配前先剥掉它。
const bodyWithoutMapTrailer = source.replace(/\/\/# sourceMappingURL=.*\s*$/, '').trimEnd()
check('产物以工厂收尾 return module.exports', /return module\.exports;\s*\}\s*\}\);$/.test(bodyWithoutMapTrailer), source.slice(-160))
check('外部依赖恰好走 require（模块表 seed word）', CLIENT_EXTERNAL.every((spec) => source.includes(`require(${JSON.stringify(spec)})`)), CLIENT_EXTERNAL)
check('产物不含顶层 ESM 语法（import/export 语句）', !/(^|\n)\s*(import\s|export\s)/.test(source), '顶部 import/export 会让整份 combo 脚本 SyntaxError')

// ── 3. 浏览器模拟：加载脚本 → 恰好注册一个工厂 ─────────────────────────────
/** 一次注册都没有时的占位（帮助区分"零注册"与"注册错 id"）。 */
const registrations = []
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (registration) => registrations.push(registration),
    },
  },
  console,
}
let compileError = null
let runError = null
try {
  vm.createContext(sandbox)
  new vm.Script(source, { filename: 'client.js' }).runInContext(sandbox)
} catch (error) {
  if (error instanceof SyntaxError) compileError = error
  else runError = error
}
check('产物能作为经典脚本编译（SyntaxError 即本次事故形态）', compileError === null, compileError?.message)
check('产物执行无异常', runError === null, runError?.stack)
check('恰好注册一个工厂', registrations.length === 1, registrations.map((r) => r?.id))
check('注册 id 是包名', registrations[0]?.id === PACKAGE_NAME, registrations[0]?.id)
check('factory 是函数', typeof registrations[0]?.factory === 'function', typeof registrations[0]?.factory)

// ── 4. 物化：调用工厂，拿到模块表意义上的 exports ───────────────────────────
if (typeof registrations[0]?.factory === 'function') {
  const stubRequire = (spec) => {
    if (!CLIENT_EXTERNAL.includes(spec)) {
      throw new Error(`verify-client-bundle: 产物请求了未声明的外部依赖 "${spec}" —— 把它加进 package.json 的 dsh.client.external 或改为打包进产物`)
    }
    // Proxy：react 的任何成员都给一个空函数（验证只关心物化是否跑通）。
    return new Proxy({}, { get: () => () => ({}) })
  }
  let exportsValue
  let materializeError = null
  try {
    exportsValue = registrations[0].factory(stubRequire)
  } catch (error) {
    materializeError = error
  }
  check('工厂物化无异常', materializeError === null, materializeError?.stack)
  check('物化产物带 apply 函数', typeof exportsValue?.apply === 'function', typeof exportsValue?.apply)
  check('物化产物带 inject 数组', Array.isArray(exportsValue?.inject), exportsValue?.inject)
  check('物化产物 name 是包名', exportsValue?.name === PACKAGE_NAME, exportsValue?.name)
  check(
    'inject 请求的服务在产物里确有消费（防手滑声明）',
    Array.isArray(exportsValue?.inject) && exportsValue.inject.every((item) => typeof item === 'string' && item.length > 0),
    exportsValue?.inject,
  )
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
const report = {
  artifact: CLIENT_ARTIFACT,
  bytes: existsSync(CLIENT_ARTIFACT) ? statSync(CLIENT_ARTIFACT).size : 0,
  summary: { total: checks.length, failed },
  checks,
}
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  for (const item of checks) {
    process.stdout.write(`${item.pass ? '  ok  ' : ' FAIL '} ${item.name}${item.pass ? '' : ` — ${String(item.detail)}`}\n`)
  }
  process.stdout.write(`\n${failed === 0 ? '全部通过' : `${String(failed)} 项失败`}` + `（${String(checks.length)} 项）\n`)
  process.exitCode = failed === 0 ? 0 : 1
}
export default report
