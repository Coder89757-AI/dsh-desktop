/**
 * Generate the 1024x1024 RGBA16 application icon PNGs from the brand SVG.
 *
 * Windows expects a rounded-square source with an ICC profile; `generate-windows-app-icon.mjs`
 * enforces a 16-bit RGBA + ICC contract before it can encode ICO frames. macOS ships a
 * full-bleed square that the Dock masks into a squircle.
 *
 * The ICC profile is reused from the current `app-icon.png` (a standard Display P3 profile,
 * brand-agnostic). When the source carries no ICC yet (first run after a clean build dir),
 * the render still succeeds but the Windows gate will reject it — drop a valid ICC source
 * once and subsequent runs self-sustain.
 */

import { readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'app-icon.svg')
const winOutput = join(buildRoot, 'app-icon.png')
const macOutput = join(buildRoot, 'app-icon-mac.png')
const iccCachePath = join(buildRoot, '_icc-cache.icc')

const CANVAS_SIZE = 1024

async function loadIcc() {
  try {
    return (await sharp(winOutput).metadata()).icc ?? null
  } catch {
    return null
  }
}

function assertContract(metadata, label) {
  if (
    metadata.format !== 'png'
    || metadata.width !== CANVAS_SIZE
    || metadata.height !== CANVAS_SIZE
    || metadata.space !== 'rgb16'
    || metadata.depth !== 'ushort'
    || metadata.bitsPerSample !== 16
    || metadata.channels !== 4
    || metadata.hasAlpha !== true
    || metadata.icc === undefined
  ) {
    throw new Error(
      `generate-app-icon-png: ${label} does not meet the 16-bit RGBA + ICC contract required by generate-windows-app-icon`,
    )
  }
}

async function render(svg, output, macSquare) {
  let source = svg
  if (macSquare) source = source.replaceAll('rx="184"', 'rx="0"')

  const icc = await loadIcc()
  let pipeline = sharp(Buffer.from(source))
    .resize({ width: CANVAS_SIZE, height: CANVAS_SIZE, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('rgb16')
    .ensureAlpha()
    .png({ palette: false })

  if (icc) {
    await writeFile(iccCachePath, icc)
    pipeline = pipeline.withIccProfile(iccCachePath)
  }

  await pipeline.toFile(output)
  await rm(iccCachePath, { force: true })
  assertContract(await sharp(output).metadata(), output)
}

const svg = await readFile(sourcePath, 'utf8')
await render(svg, winOutput, false)
await render(svg, macOutput, true)
console.log('app-icon.png + app-icon-mac.png regenerated (1024x1024 RGBA16 + ICC)')
