/** Legal-KB launcher and connection-panel styles, themed with dsw alias tokens. */

import { legalKbIconMaskDataUri } from './legal-kb-icon.ts'

const STYLE_ID = 'dsh-plugin-desktop-legal-kb-styles'

const ICON_MASK = `url("${legalKbIconMaskDataUri}") center / contain no-repeat`

const CSS = `
.dshLegalKbLauncher {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 4px);
  margin: 0 -2px;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
}
.dshLegalKbLauncher:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshLegalKbLauncher[data-wide='false'] { justify-content: center; padding: 8px 0; }
.dshLegalKbLauncherIcon {
  display: inline-block;
  width: 18px;
  height: 18px;
  flex: none;
  background-color: currentColor;
  -webkit-mask: ${ICON_MASK};
  mask: ${ICON_MASK};
}
.dshLegalKbLauncherLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 13px;
}
.dshLegalKbLauncherState {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-border-l2);
}
.dshLegalKbLauncherState[data-on='true'] { background: var(--dsw-alias-state-success-primary); }

.dshLegalKbBackdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483002;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 55%, transparent);
}
.dshLegalKbPanel {
  width: min(420px, calc(100vw - 48px));
  max-height: min(560px, calc(100vh - 96px));
  overflow-y: auto;
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 24px 64px color-mix(in srgb, #000 38%, transparent);
}
.dshLegalKbPanelHeader {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dshLegalKbPanelHeader h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.dshLegalKbHeaderIcon {
  display: inline-block;
  width: 20px;
  height: 20px;
  flex: none;
  background-color: currentColor;
  -webkit-mask: ${ICON_MASK};
  mask: ${ICON_MASK};
}
.dshLegalKbClose {
  display: flex;
  border: none;
  padding: 4px;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshLegalKbClose:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshLegalKbIntro { margin: 10px 0 14px; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 1.6; }

.dshLegalKbState {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshLegalKbStateBadge {
  align-self: flex-start;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.dshLegalKbState[data-connected='true'] .dshLegalKbStateBadge { color: var(--dsw-alias-state-success-primary); }
.dshLegalKbIdentity { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.dshLegalKbIdentity > div { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; }
.dshLegalKbIdentity dt { color: var(--dsw-alias-label-secondary); }
.dshLegalKbIdentity dd { margin: 0; text-align: right; overflow-wrap: anywhere; }

.dshLegalKbForm { display: flex; flex-direction: column; gap: 10px; }
.dshLegalKbField {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
}
.dshLegalKbInput {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.dshLegalKbInput:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent);
}
.dshLegalKbAdvancedToggle {
  align-self: flex-start;
  border: none;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dshLegalKbAdvancedToggle:hover { color: var(--dsw-alias-label-primary); }
.dshLegalKbAdvanced {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
}
.dshLegalKbError {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  font-size: 12.5px;
  line-height: 1.55;
}
.dshLegalKbActions { display: flex; gap: 8px; }
.dshLegalKbPrimary, .dshLegalKbSecondary {
  padding: 8px 16px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dshLegalKbPrimary {
  border: none;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshLegalKbPrimary:disabled { cursor: default; opacity: .5; }
.dshLegalKbSecondary {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.dshLegalKbSecondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshLegalKbSecondary:disabled { cursor: default; opacity: .5; }
.dshLegalKbHint {
  margin: 14px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.6;
}
`

/** Install the Legal-KB sheet once; tolerate headless Client boot. */
export function installLegalKbStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/legal-kb'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
