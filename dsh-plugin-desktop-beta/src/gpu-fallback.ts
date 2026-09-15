/** Startup fallback for machines whose GPU process cannot survive Electron startup. */

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  DesktopChildProcessDetails,
  DesktopChildProcessSource,
} from './desktop-logger.ts'

/**
 * Launch marker that clears a recorded GPU failure and keeps hardware
 * acceleration enabled. The documented escape hatch from an automatic downgrade.
 * Relaunches keep the flag, so it governs the whole session, not one process.
 */
export const DESKTOP_ENABLE_GPU_ARGUMENT = '--dsh-desktop-enable-gpu'

const STATE_DIRECTORY_NAME = 'gpu-fallback'
const STATE_FILENAME = 'state.json'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

/** GPU process failures recorded so the next launch can drop hardware acceleration. */
export interface DesktopGpuFailureRecord {
  /** Number of recorded failures since the state was last cleared. */
  readonly gpuFailures: number
  readonly firstFailureAt: string
  readonly lastFailureAt: string
  readonly reason: string
  readonly version: string
}

/** Persisted hardware acceleration decision, read before the app becomes ready. */
export type DesktopGpuFailureState =
  | { readonly status: 'absent' }
  | { readonly status: 'unreadable' }
  | { readonly status: 'recorded'; readonly record: DesktopGpuFailureRecord }

/** Minimal logger surface used on the startup path. */
export interface DesktopGpuFallbackLogger {
  error(message: string): void
}

/** Recorded failures are sticky across launches; only the escape hatch clears them. */
export interface DesktopGpuFailureTrackingOptions {
  readonly statePath: string
  readonly version: string
  readonly logger: DesktopGpuFallbackLogger
  readonly now?: () => Date
}

/** Persist one GPU failure, keeping the first failure time of the current streak. */
export interface DesktopGpuFailureInput {
  readonly reason: string
  readonly version: string
  readonly now?: () => Date
}

/** Pre-readiness inputs deciding whether this launch keeps hardware acceleration. */
export interface DesktopGpuFallbackOptions {
  readonly argv: readonly string[]
  readonly statePath: string
  readonly logger: DesktopGpuFallbackLogger
  readonly disableHardwareAcceleration: () => void
}

/** Resolve the state file holding the persisted hardware acceleration decision. */
export function desktopGpuFailureStatePath(userDataDir: string): string {
  return join(userDataDir, STATE_DIRECTORY_NAME, STATE_FILENAME)
}

/** Detect the one-shot argument that retries hardware acceleration. */
export function desktopHardwareAccelerationOverridden(argv: readonly string[]): boolean {
  return argv.slice(1).includes(DESKTOP_ENABLE_GPU_ARGUMENT)
}

/**
 * Treat every GPU child process exit except a clean stop as a failure worth
 * downgrading for: `crashed`, `abnormal-exit`, `launch-failed`, and `oom` all
 * mean the next launch cannot rely on hardware acceleration.
 */
export function isDesktopGpuProcessFailure(details: DesktopChildProcessDetails): boolean {
  return details.type === 'GPU' && details.reason !== 'clean-exit'
}

function lstatOptional(filename: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

function assertOwnedStateFile(stats: NonNullable<ReturnType<typeof lstatSync>>): void {
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1) {
    throw new Error('dsh-plugin-desktop: GPU fallback state is invalid')
  }
}

function noFollowFlag(): number {
  return process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
}

function parseFailureRecord(value: unknown): DesktopGpuFailureRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Partial<DesktopGpuFailureRecord>
  if (typeof record.gpuFailures !== 'number' || !Number.isInteger(record.gpuFailures)
    || record.gpuFailures < 1
    || typeof record.firstFailureAt !== 'string'
    || typeof record.lastFailureAt !== 'string'
    || typeof record.reason !== 'string'
    || typeof record.version !== 'string') return undefined
  return {
    gpuFailures: record.gpuFailures,
    firstFailureAt: record.firstFailureAt,
    lastFailureAt: record.lastFailureAt,
    reason: record.reason,
    version: record.version,
  }
}

/** Read the persisted decision, distinguishing a missing file from a damaged one. */
export function readDesktopGpuFailureState(statePath: string): DesktopGpuFailureState {
  const pathStats = lstatOptional(statePath)
  if (pathStats === undefined) return { status: 'absent' }
  try {
    assertOwnedStateFile(pathStats)
    const descriptor = openSync(statePath, constants.O_RDONLY | noFollowFlag())
    try {
      assertOwnedStateFile(fstatSync(descriptor))
      const record = parseFailureRecord(JSON.parse(readFileSync(descriptor, 'utf8')) as unknown)
      return record === undefined ? { status: 'unreadable' } : { status: 'recorded', record }
    } finally {
      closeSync(descriptor)
    }
  } catch {
    return { status: 'unreadable' }
  }
}

function writeState(statePath: string, record: DesktopGpuFailureRecord): void {
  const directory = dirname(statePath)
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  try { chmodSync(directory, PRIVATE_DIRECTORY_MODE) } catch {}
  const temporary = join(directory, `.${basename(statePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: PRIVATE_FILE_MODE,
    })
    try { chmodSync(temporary, PRIVATE_FILE_MODE) } catch {}
    renameSync(temporary, statePath)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
}

/**
 * Persist one GPU failure. The result is sticky so that an intermittent crash
 * still downgrades the next launch; `--dsh-desktop-enable-gpu` clears it.
 */
export function recordDesktopGpuFailure(
  statePath: string,
  input: DesktopGpuFailureInput,
): DesktopGpuFailureRecord {
  const timestamp = (input.now ?? (() => new Date()))().toISOString()
  const previous = readDesktopGpuFailureState(statePath)
  const record: DesktopGpuFailureRecord = {
    gpuFailures: previous.status === 'recorded' ? previous.record.gpuFailures + 1 : 1,
    firstFailureAt: previous.status === 'recorded' ? previous.record.firstFailureAt : timestamp,
    lastFailureAt: timestamp,
    reason: input.reason,
    version: input.version,
  }
  writeState(statePath, record)
  return record
}

/** Drop the recorded failures. Returns whether anything was actually removed. */
export function clearDesktopGpuFailureState(statePath: string): boolean {
  try {
    unlinkSync(statePath)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

/**
 * Apply the persisted decision before the app becomes ready. Hardware
 * acceleration can only be disabled while the app is not ready, so this runs on
 * the startup path and must never be able to abort it: every failure is logged
 * and swallowed. A damaged state file is reported and ignored rather than
 * silently pinning the app to software rendering.
 */
export function applyDesktopGpuFallback(options: DesktopGpuFallbackOptions): void {
  const { logger, statePath } = options
  try {
    if (desktopHardwareAccelerationOverridden(options.argv)) {
      const cleared = clearDesktopGpuFailureState(statePath)
      logger.error(cleared
        ? `dsh-plugin-desktop: hardware acceleration re-enabled by ${DESKTOP_ENABLE_GPU_ARGUMENT}; cleared the recorded GPU failure state`
        : `dsh-plugin-desktop: hardware acceleration kept enabled by ${DESKTOP_ENABLE_GPU_ARGUMENT}`)
      return
    }
    const state = readDesktopGpuFailureState(statePath)
    if (state.status === 'absent') return
    if (state.status === 'unreadable') {
      logger.error(`dsh-plugin-desktop: ignoring an unreadable GPU fallback state at ${statePath}`)
      return
    }
    options.disableHardwareAcceleration()
    logger.error(
      `dsh-plugin-desktop: starting without hardware acceleration after ${String(state.record.gpuFailures)} recorded GPU failure(s) `
      + `(last: ${state.record.reason} at ${state.record.lastFailureAt}); launch with ${DESKTOP_ENABLE_GPU_ARGUMENT} to retry hardware acceleration`,
    )
  } catch (cause) {
    logger.error(`dsh-plugin-desktop: GPU fallback unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Persist GPU child process failures so the next launch can downgrade. */
export function installDesktopGpuFailureTracking(
  app: DesktopChildProcessSource,
  options: DesktopGpuFailureTrackingOptions,
): () => void {
  const handler = (_event: unknown, details: DesktopChildProcessDetails): void => {
    if (!isDesktopGpuProcessFailure(details)) return
    try {
      const record = recordDesktopGpuFailure(options.statePath, {
        reason: details.reason,
        version: options.version,
        ...(options.now === undefined ? {} : { now: options.now }),
      })
      options.logger.error(
        `dsh-plugin-desktop: GPU process failed (reason: ${details.reason}, `
        + `exitCode: ${String(details.exitCode)}); the next launch will start without hardware acceleration `
        + `(${String(record.gpuFailures)} recorded failure(s), state: ${options.statePath})`,
      )
    } catch (cause) {
      options.logger.error(`dsh-plugin-desktop: failed to record the GPU process failure: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  app.on('child-process-gone', handler)
  return () => { app.off('child-process-gone', handler) }
}
