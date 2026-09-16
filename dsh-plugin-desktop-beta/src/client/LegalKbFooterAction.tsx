/** Legal-KB sidebar footer entry: connection panel launcher. */

import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LegalKbStatusResponse } from '../legal-kb/contract.ts'
import { legalKbIconDataUri } from './legal-kb-icon.ts'
import type { LegalKbApi } from './legal-kb-api.ts'
import type { LegalKbLocaleKey } from './legal-kb-locales.ts'

/** Registration-side capabilities for the Legal-KB entry. */
export interface LegalKbFooterActionInjected {
  readonly api: LegalKbApi
}

/** Renderer-composed Legal-KB footer action props. */
export type LegalKbFooterActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'legal-kb'>
  & InjectFace<LegalKbFooterActionInjected>

function formatCredits(credits: number): string {
  return credits.toFixed(2).replace(/\.?0+$/u, '')
}

function formatExpiry(expiresAt: number, t: (key: LegalKbLocaleKey) => string): string {
  return new Date(expiresAt * 1000).toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }) || t('identityPermanent')
}

/** Render the sidebar footer launcher and its connection panel. */
export function LegalKbFooterAction({ api, t, wide }: LegalKbFooterActionProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [status, setStatus] = useState<LegalKbStatusResponse>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [code, setCode] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState<'activate' | 'disconnect' | undefined>()
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (fetcher: LegalKbApi = api): Promise<void> => {
    const next = await fetcher.status()
    setStatus(next)
    setApiUrl(next.apiUrl)
    setMcpUrl(next.mcpUrl)
  }, [api])

  useEffect(() => {
    if (!panelOpen || status !== undefined) return
    void refresh().catch(() => { setLoadFailed(true) })
  }, [panelOpen, status, refresh])

  useEffect(() => {
    if (!panelOpen) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPanelOpen(false)
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape) }
  }, [panelOpen])

  const activate = (): void => {
    const trimmed = code.trim()
    if (trimmed.length === 0 || busy !== undefined) return
    setBusy('activate')
    setError(null)
    void (async () => {
      const connected = status?.connected === true
      if (connected) await api.disconnect().catch(() => {})
      const next = await api.activate(trimmed)
      setStatus(next)
      setCode('')
      setShowAdvanced(false)
    })()
      .catch((cause: unknown) => {
        setError(cause instanceof Error && cause.message.length > 0 && !cause.message.startsWith('dsh-plugin-desktop:')
          ? cause.message
          : t('activateFailed'))
      })
      .finally(() => { setBusy(undefined) })
  }

  const disconnect = (): void => {
    if (busy !== undefined) return
    setBusy('disconnect')
    setError(null)
    void api.disconnect()
      .then(() => refresh())
      .catch(() => { setError(t('activateFailed')) })
      .finally(() => { setBusy(undefined) })
  }

  const connected = status?.connected === true
  const identity = status?.identity ?? null

  return (
    <>
      <button
        type="button"
        className="dshLegalKbLauncher"
        data-wide={wide ? 'true' : 'false'}
        data-connected={connected ? 'true' : 'false'}
        title={t('railTitle')}
        onClick={() => { setPanelOpen(true) }}
      >
        <img src={legalKbIconDataUri} alt="" aria-hidden="true" className="dshLegalKbLauncherIcon" />
        {wide && <span className="dshLegalKbLauncherLabel">{t('title')}</span>}
        {wide && <span className="dshLegalKbLauncherState" data-on={connected ? 'true' : 'false'} aria-hidden="true" />}
      </button>
      {panelOpen && (
        <div className="dshLegalKbBackdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) setPanelOpen(false) }}>
          <div className="dshLegalKbPanel" role="dialog" aria-modal="true" aria-label={t('title')}>
            <header className="dshLegalKbPanelHeader">
              <img src={legalKbIconDataUri} alt="" aria-hidden="true" className="dshLegalKbHeaderIcon" />
              <h2>{t('title')}</h2>
              <button
                type="button"
                className="dshLegalKbClose"
                aria-label={t('close')}
                onClick={() => { setPanelOpen(false) }}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <p className="dshLegalKbIntro">{t('intro')}</p>

            {loadFailed && status === undefined && (
              <p className="dshLegalKbError" role="alert">{t('loadFailed')}</p>
            )}
            {!loadFailed && status !== undefined && (
              <div className="dshLegalKbState" data-connected={connected ? 'true' : 'false'}>
                <span className="dshLegalKbStateBadge">{connected ? t('connected') : t('notConnected')}</span>
                {connected && identity !== null && (
                  <dl className="dshLegalKbIdentity">
                    {identity.name !== '' && <div><dt>{t('identityName')}</dt><dd>{identity.name}</dd></div>}
                    {identity.org !== '' && <div><dt>{t('identityOrg')}</dt><dd>{identity.org}</dd></div>}
                    {identity.credits !== null && <div><dt>{t('identityCredits')}</dt><dd>{formatCredits(identity.credits)}</dd></div>}
                    {identity.expiresAt !== null && <div><dt>{t('identityExpires')}</dt><dd>{formatExpiry(identity.expiresAt, t)}</dd></div>}
                  </dl>
                )}
              </div>
            )}

            <form className="dshLegalKbForm" onSubmit={event => { event.preventDefault(); activate() }}>
              <label className="dshLegalKbField">
                {t('licenseCode')}
                <input
                  className="dshLegalKbInput"
                  value={code}
                  onChange={event => { setCode(event.currentTarget.value) }}
                  placeholder={t('licenseCodePlaceholder')}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={128}
                />
              </label>
              <button type="button" className="dshLegalKbAdvancedToggle" aria-expanded={showAdvanced} onClick={() => { setShowAdvanced(value => !value) }}>
                {t('advanced')}
              </button>
              {showAdvanced && (
                <div className="dshLegalKbAdvanced">
                  <label className="dshLegalKbField">
                    {t('apiUrl')}
                    <input
                      className="dshLegalKbInput"
                      value={apiUrl}
                      onChange={event => { setApiUrl(event.currentTarget.value) }}
                      spellCheck={false}
                    />
                  </label>
                  <label className="dshLegalKbField">
                    {t('mcpUrl')}
                    <input
                      className="dshLegalKbInput"
                      value={mcpUrl}
                      onChange={event => { setMcpUrl(event.currentTarget.value) }}
                      spellCheck={false}
                    />
                  </label>
                </div>
              )}
              {error !== null && <p className="dshLegalKbError" role="alert">{error}</p>}
              <div className="dshLegalKbActions">
                <button
                  type="submit"
                  className="dshLegalKbPrimary"
                  disabled={code.trim().length === 0 || busy !== undefined}
                >
                  {busy === 'activate' ? t('activating') : t('activate')}
                </button>
                {connected && (
                  <button
                    type="button"
                    className="dshLegalKbSecondary"
                    disabled={busy !== undefined}
                    onClick={disconnect}
                  >
                    {busy === 'disconnect' ? t('disconnecting') : t('disconnect')}
                  </button>
                )}
              </div>
            </form>
            <p className="dshLegalKbHint">{t('toolsHint')}</p>
          </div>
        </div>
      )}
    </>
  )
}
