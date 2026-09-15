import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  applyDesktopGpuFallback,
  clearDesktopGpuFailureState,
  DESKTOP_ENABLE_GPU_ARGUMENT,
  desktopGpuFailureStatePath,
  desktopHardwareAccelerationOverridden,
  installDesktopGpuFailureTracking,
  isDesktopGpuProcessFailure,
  readDesktopGpuFailureState,
  recordDesktopGpuFailure,
} from '../src/gpu-fallback.ts'

const GPU_CRASH = {
  type: 'GPU',
  reason: 'crashed',
  exitCode: -2147483645,
  serviceName: 'GPU',
  name: 'GPU',
}

function temporaryStatePath(): string {
  return desktopGpuFailureStatePath(mkdtempSync(join(tmpdir(), 'dsh-gpu-')))
}

function failureLogger() {
  return { error: vi.fn<(message: string) => void>() }
}

describe('Desktop GPU fallback', () => {
  it('resolves the state file inside the Desktop user data directory', () => {
    expect(desktopGpuFailureStatePath(join('root', 'userData')))
      .toBe(join('root', 'userData', 'gpu-fallback', 'state.json'))
  })

  it('treats only non-clean GPU child process exits as failures', () => {
    expect(isDesktopGpuProcessFailure(GPU_CRASH)).toBe(true)
    expect(isDesktopGpuProcessFailure({ ...GPU_CRASH, reason: 'abnormal-exit' })).toBe(true)
    expect(isDesktopGpuProcessFailure({ ...GPU_CRASH, type: 'Utility' })).toBe(false)
    expect(isDesktopGpuProcessFailure({ ...GPU_CRASH, reason: 'clean-exit' })).toBe(false)
  })

  it('records a GPU crash so the next launch starts without hardware acceleration', () => {
    const statePath = temporaryStatePath()
    const app = new EventEmitter()
    const logger = failureLogger()
    const disableHardwareAcceleration = vi.fn()

    applyDesktopGpuFallback({
      argv: ['Lexford.exe'],
      statePath,
      logger,
      disableHardwareAcceleration,
    })
    expect(disableHardwareAcceleration).not.toHaveBeenCalled()

    const remove = installDesktopGpuFailureTracking(app, {
      statePath,
      version: '2.0.10',
      logger,
      now: () => new Date('2026-09-15T05:21:47.598Z'),
    })
    app.emit('child-process-gone', {}, GPU_CRASH)

    expect(readDesktopGpuFailureState(statePath)).toEqual({
      status: 'recorded',
      record: {
        gpuFailures: 1,
        firstFailureAt: '2026-09-15T05:21:47.598Z',
        lastFailureAt: '2026-09-15T05:21:47.598Z',
        reason: 'crashed',
        version: '2.0.10',
      },
    })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('the next launch will start without hardware acceleration'))

    applyDesktopGpuFallback({
      argv: ['Lexford.exe'],
      statePath,
      logger,
      disableHardwareAcceleration,
    })
    expect(disableHardwareAcceleration).toHaveBeenCalledOnce()

    remove()
    expect(app.listenerCount('child-process-gone')).toBe(0)
  })

  it('ignores child processes that are not the GPU process', () => {
    const statePath = temporaryStatePath()
    const app = new EventEmitter()
    const logger = failureLogger()
    const remove = installDesktopGpuFailureTracking(app, {
      statePath,
      version: '2.0.10',
      logger,
    })

    app.emit('child-process-gone', {}, {
      type: 'Utility',
      reason: 'crashed',
      exitCode: -1073741819,
      serviceName: 'network.mojom.NetworkService',
    })

    expect(existsSync(statePath)).toBe(false)
    expect(logger.error).not.toHaveBeenCalled()
    remove()
  })

  it('accumulates failures while keeping the first failure time', () => {
    const statePath = temporaryStatePath()

    recordDesktopGpuFailure(statePath, {
      reason: 'crashed',
      version: '2.0.10',
      now: () => new Date('2026-09-15T05:21:47.598Z'),
    })
    const record = recordDesktopGpuFailure(statePath, {
      reason: 'abnormal-exit',
      version: '2.0.10',
      now: () => new Date('2026-09-15T06:00:00.000Z'),
    })

    expect(record).toEqual({
      gpuFailures: 2,
      firstFailureAt: '2026-09-15T05:21:47.598Z',
      lastFailureAt: '2026-09-15T06:00:00.000Z',
      reason: 'abnormal-exit',
      version: '2.0.10',
    })
  })

  it('keeps hardware acceleration when the escape hatch is passed', () => {
    const statePath = temporaryStatePath()
    const logger = failureLogger()
    const disableHardwareAcceleration = vi.fn()
    recordDesktopGpuFailure(statePath, { reason: 'crashed', version: '2.0.10' })

    expect(desktopHardwareAccelerationOverridden(['Lexford.exe', DESKTOP_ENABLE_GPU_ARGUMENT])).toBe(true)
    expect(desktopHardwareAccelerationOverridden(['Lexford.exe', `${DESKTOP_ENABLE_GPU_ARGUMENT}=true`])).toBe(false)

    applyDesktopGpuFallback({
      argv: ['Lexford.exe', DESKTOP_ENABLE_GPU_ARGUMENT],
      statePath,
      logger,
      disableHardwareAcceleration,
    })

    expect(disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(readDesktopGpuFailureState(statePath)).toEqual({ status: 'absent' })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('hardware acceleration re-enabled'))
  })

  it('ignores a damaged state file instead of pinning software rendering', () => {
    const statePath = temporaryStatePath()
    const logger = failureLogger()
    const disableHardwareAcceleration = vi.fn()
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, '{ not json', 'utf8')

    expect(readDesktopGpuFailureState(statePath)).toEqual({ status: 'unreadable' })

    applyDesktopGpuFallback({
      argv: ['Lexford.exe'],
      statePath,
      logger,
      disableHardwareAcceleration,
    })

    expect(disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ignoring an unreadable GPU fallback state'))
  })

  it('never aborts the startup path when disabling hardware acceleration fails', () => {
    const statePath = temporaryStatePath()
    const logger = failureLogger()
    recordDesktopGpuFailure(statePath, { reason: 'crashed', version: '2.0.10' })

    expect(() => {
      applyDesktopGpuFallback({
        argv: ['Lexford.exe'],
        statePath,
        logger,
        disableHardwareAcceleration: () => { throw new Error('too late to disable') },
      })
    }).not.toThrow()
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('GPU fallback unavailable: too late to disable'))
  })

  it('reports whether a recorded failure was actually cleared', () => {
    const statePath = temporaryStatePath()
    expect(clearDesktopGpuFailureState(statePath)).toBe(false)
    recordDesktopGpuFailure(statePath, { reason: 'crashed', version: '2.0.10' })
    expect(clearDesktopGpuFailureState(statePath)).toBe(true)
    expect(readDesktopGpuFailureState(statePath)).toEqual({ status: 'absent' })
  })

  it('writes the record as JSON newline terminated', () => {
    const statePath = temporaryStatePath()
    recordDesktopGpuFailure(statePath, { reason: 'crashed', version: '2.0.10' })
    expect(readFileSync(statePath, 'utf8').endsWith('}\n')).toBe(true)
  })
})
