/** Offline-plugins panel styles, installed once per client boot. */

const STYLE_ID = 'dshOfflinePluginsStyles'

/* Every color resolves through a `--dsw-alias-*` token so the panel follows the
 * active theme. Bare `--dsh-*` names, which nothing defines, would render the
 * light-mode literals written as their fallbacks and stay light under the dark
 * theme. */
const CSS = `
.dshOfflineSection {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
}
.dshOfflineTitle { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }
.dshOfflineIntro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.dshOfflineStatus { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.dshOfflineNotice {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.dshOfflineNotice[data-kind='ok'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
.dshOfflineNotice[data-kind='error'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.dshOfflineGroup { display: flex; flex-direction: column; gap: 10px; }
.dshOfflineGroupHead {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineGroupCount { font-variant-numeric: tabular-nums; }

.dshOfflineCards { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dshOfflineCard {
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s, background .16s;
}
.dshOfflineCard:hover { border-color: var(--dsw-alias-label-dimmed); }
.dshOfflineCardHead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.dshOfflineCardText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dshOfflineCardTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshOfflineCardMeta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}

.dshOfflineTag {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  corner-shape: round;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
  white-space: nowrap;
}
.dshOfflineTag[data-tone='outline'] {
  border: 0.5px solid var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineTag[data-tone='neutral'] {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.dshOfflineTag[data-tone='info'] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
  color: var(--dsw-alias-state-business-primary);
}

.dshOfflineActions { display: flex; flex-wrap: wrap; gap: 10px; }
.dshOfflineBtn {
  box-sizing: border-box;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  transition: background .16s, border-color .16s, color .16s;
}
.dshOfflineBtn[data-size='sm'] {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 12px;
  line-height: 18px;
}
.dshOfflineBtn:disabled { opacity: .4; cursor: default; }
.dshOfflineBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshOfflineBtn[data-variant='primary'] {
  border: none;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshOfflineBtn[data-variant='primary']:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dshOfflineBtn[data-variant='secondary'] { border: 0.5px solid var(--dsw-alias-border-l3); }
.dshOfflineBtn[data-variant='secondary']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshOfflineBtn[data-variant='dashed'] {
  flex: 1 1 0;
  min-width: 180px;
  height: 44px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 16px;
}
.dshOfflineBtn[data-variant='dashed']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }

.dshOfflineProgressBlock {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshOfflineProgressHead { display: flex; align-items: baseline; gap: 8px; }
.dshOfflineProgressLabel {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineProgressCount {
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
.dshOfflineProgressSpacer { flex: 1; min-width: 0; }
.dshOfflineProgressBytes {
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineProgressTrack {
  height: 6px;
  border-radius: 999px;
  corner-shape: round;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.dshOfflineProgressFill {
  height: 100%;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-button-primary-fill);
  transition: width .2s ease;
}
/* Before the job exists there is no ratio to show — the Host is still walking
   the dependency closure — so the bar sweeps instead of filling. */
.dshOfflineProgressFill[data-indeterminate='true'] {
  width: 30%;
  animation: dshOfflineProgressSweep 1.1s linear infinite;
}
@keyframes dshOfflineProgressSweep {
  from { transform: translateX(-110%); }
  to { transform: translateX(345%); }
}
.dshOfflineProgressNote {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dshOfflineProgressPackage {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}

.dshOfflineEmpty {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 12px;
  text-align: center;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

@media (prefers-reduced-motion: reduce) {
  .dshOfflineCard,
  .dshOfflineBtn,
  .dshOfflineProgressFill { transition: none; }

  /* A still bar at a fixed fraction still reads as "work in progress". */
  .dshOfflineProgressFill[data-indeterminate='true'] { animation: none; width: 40%; }
}
`

export function installOfflinePluginsStyles(): () => void {
  document.getElementById(STYLE_ID)?.remove()
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.append(element)
  return () => { element.remove() }
}
