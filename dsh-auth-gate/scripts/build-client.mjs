/**
 * 打包 Client 半边 → `lib/client.js`。
 *
 * ## 为什么必须打包
 *
 * desktop 的 `client-modules` **不是**把 client 入口当模块加载的，而是把
 * 「一个已经打包好的产物」当**经典脚本**（classic script）塞进 `<script src>`：
 *
 *   - host 侧读 `exports["./client"]` 指向的**文件字节**（`readFileSync`），
 *     拼进 combo 端点 `/plugins/??<pkg>/client.js,...&rev=...`；
 *   - 浏览器侧那份产物必须自己调用 `window.__ModuleLoader__.load({id, factory})`
 *     注册工厂。模块体（含 CSS 注入）全部包在 factory 闭包里，**惰性执行**。
 *
 * 所以如果交上去的是原始 ESM 源码（带顶层 `import`/`export`），浏览器解析整个
 * combo 脚本时直接 SyntaxError → **一个工厂都注册不上**，报错却会指向该 combo 里
 * 第一个被 await 的条目（往往是无关的 `dsh-client-hmr`），极易误判。
 *
 * 包装契约与 `dsh-community-market/tsdown.config.ts` 完全一致（banner/intro/footer），
 * 三处字符串一个字符都不能差，否则模块表拿不到 `module.exports`。
 *
 * ## 为什么用仓库里的 rolldown
 *
 * 本包**不在根 Yarn workspace 里**（`scripts/verify-layout.mjs` 对 `workspaces`
 * 做精确比对），因此自己没有 `node_modules`、也拿不到 `tsdown`。这里从
 * `dsh-community-market` / `dsh-plugin-desktop` 的 `node_modules` 里借
 * `rolldown`（tsdown 的底层实现）—— 只在**开发期**需要，产物是提交进仓库的。
 *
 * 用法：`node dsh-auth-gate/scripts/build-client.mjs`
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(HERE, '..')
const REPO_ROOT = join(PLUGIN_DIR, '..')

/** 产物路径：`exports["./client"]` 指向它。 */
export const CLIENT_ARTIFACT = join(PLUGIN_DIR, 'lib', 'client.js')

/** 源码入口。 */
export const CLIENT_SOURCE = join(PLUGIN_DIR, 'src', 'client', 'index.js')

/** 模块表里注册用的 id —— 必须是包名。 */
export const PACKAGE_NAME = 'dsh-auth-gate'

/**
 * 产物被要求的外部依赖：`react` 由模块表（seed word）提供，不打进来。
 * 多一项少一项都会让 factory 里的 `require(...)` 在运行时报「unknown module」。
 */
export const CLIENT_EXTERNAL = ['react']

/**
 * 借一个已安装 `rolldown` 的宿主包来解析它。
 *
 * @returns {string} `rolldown` 入口文件的绝对路径。
 * @throws {Error} 三个候选位置都不存在时。
 */
function resolveRolldown() {
  const hosts = ['dsh-community-market', 'dsh-plugin-desktop', 'dsh-plugin-desktop-beta']
  const tried = []
  for (const host of hosts) {
    const manifest = join(REPO_ROOT, host, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      return createRequire(manifest).resolve('rolldown')
    } catch (error) {
      tried.push(`${host}: ${String(error?.code ?? error?.message ?? error)}`)
    }
  }
  throw new Error(
    `dsh-auth-gate: cannot resolve "rolldown" from any host package — run it after a Yarn install.\n  ${tried.join('\n  ')}`,
  )
}

/**
 * 跑一次打包。
 *
 * @param {object} [options] - 选项。
 * @param {string} [options.outFile] - 输出文件；默认写进 `lib/client.js`。
 * @returns {Promise<{code: string, map: string | null}>} 产物字节（utf8）与 source map。
 */
export async function buildClient(options = {}) {
  const outFile = options.outFile ?? CLIENT_ARTIFACT
  const { rolldown } = await import(pathToFileURL(resolveRolldown()).href)

  const bundle = await rolldown({
    input: CLIENT_SOURCE,
    external: CLIENT_EXTERNAL,
    platform: 'browser',
  })

  try {
    mkdirSync(dirname(outFile), { recursive: true })
    const output = await bundle.generate({
      file: outFile,
      format: 'cjs',
      // ↓↓↓ 与 dsh-community-market/tsdown.config.ts 的三段包装逐字一致 ↓↓↓
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
      // ↑↑↑ 改这里等于改协议，先读文件头注释 ↑↑↑
      sourcemap: true,
    })

    const chunk = output.output.find((item) => item.type === 'chunk')
    if (chunk === undefined) throw new Error('dsh-auth-gate: rolldown produced no chunk')
    const map = chunk.map === null || chunk.map === undefined ? null : JSON.stringify(chunk.map)

    writeFileSync(outFile, chunk.code, 'utf8')
    if (map !== null) writeFileSync(`${outFile}.map`, map, 'utf8')

    return { code: chunk.code, map }
  } finally {
    await bundle.close()
  }
}

/**
 * 源码是否比产物新（「改了源码忘了重新打包」的廉价探测）。
 *
 * @returns {boolean} true 表示产物已过期。
 */
export function clientArtifactIsStale() {
  if (!existsSync(CLIENT_ARTIFACT)) return true
  const built = statSync(CLIENT_ARTIFACT).mtimeMs
  const sources = [
    CLIENT_SOURCE,
    join(PLUGIN_DIR, 'lib', 'constants.js'),
    join(PLUGIN_DIR, 'lib', 'gate-mode.js'),
    ...listDir(join(PLUGIN_DIR, 'src', 'client')).map((name) => join(PLUGIN_DIR, 'src', 'client', name)),
  ]
  return sources.some((file) => existsSync(file) && statSync(file).mtimeMs > built)
}

/** 列目录（失败时返回空数组，让新鲜度探测退化成"只看入口与共享模块"）。 */
function listDir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

// 直接 `node scripts/build-client.mjs` 运行时才真正执行；被 import 时只导出上面这些。
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { code } = await buildClient()
  process.stdout.write(
    `dsh-auth-gate: built ${CLIENT_ARTIFACT} (${String(Buffer.byteLength(code))} bytes)\n`,
  )
}
