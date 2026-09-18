/** Skill-manager panel styles, installed once per client boot. */

const STYLE_ID = 'dshSkillManagerStyles'

/* Every color resolves through a `--dsw-alias-*` token so the panel follows the
 * active theme. Bare `--dsh-*` names, which nothing defines, would render the
 * light-mode literals written as their fallbacks and stay light under the dark
 * theme. */
const CSS = `
.dshSkillManagerSection {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 760px;
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerTitle { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }
.dshSkillManagerIntro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.dshSkillManagerTabs {
  display: flex;
  align-items: flex-end;
  gap: 22px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dshSkillManagerTab {
  position: relative;
  border: 0;
  padding: 7px 1px 9px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dshSkillManagerTab:hover,
.dshSkillManagerTab[data-active='true'] { color: var(--dsw-alias-label-primary); }
.dshSkillManagerTab[data-active='true']::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--dsw-alias-label-primary);
  content: '';
}
.dshSkillManagerTab:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
  border-radius: 2px;
  color: var(--dsw-alias-label-primary);
}

.dshSkillManagerPanel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dshSkillManagerStatus { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }

.dshSkillManagerNotice {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.dshSkillManagerNotice[data-kind='ok'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}
.dshSkillManagerNotice[data-kind='error'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
}

.dshSkillManagerGroup { display: flex; flex-direction: column; gap: 10px; }
.dshSkillManagerGroupHead {
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
.dshSkillManagerGroupCount { font-variant-numeric: tabular-nums; }

.dshSkillManagerCards { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dshSkillManagerCard {
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-3);
  transition: border-color .16s, background .16s;
}
.dshSkillManagerCard:hover { border-color: var(--dsw-alias-label-dimmed); }
.dshSkillManagerCard[data-open='true'] {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-label-dimmed);
}
.dshSkillManagerCardHead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
.dshSkillManagerCardToggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dshSkillManagerCardToggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshSkillManagerCardText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dshSkillManagerCardTitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerCardDesc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerCardMeta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerCardActions { display: inline-flex; flex: none; align-items: center; gap: 8px; }

.dshSkillManagerChevron {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--dsw-alias-label-tertiary);
  transition: transform .16s;
}
.dshSkillManagerChevron::before {
  display: block;
  width: 6px;
  height: 6px;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  transform: rotate(45deg) translate(-1px, -1px);
  content: '';
}
.dshSkillManagerCardToggle[aria-expanded='true'] .dshSkillManagerChevron { transform: rotate(180deg); }

.dshSkillManagerCardBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding: 12px 0;
}

.dshSkillManagerModes {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshSkillManagerModeBtn {
  border: 0;
  border-radius: 8px;
  padding: 4px 12px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dshSkillManagerModeBtn:hover { color: var(--dsw-alias-label-primary); }
.dshSkillManagerModeBtn[data-active='true'] {
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerModeBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }

.dshSkillManagerField { display: flex; flex-direction: column; gap: 6px; }
.dshSkillManagerFieldLabel { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dshSkillManagerInput,
.dshSkillManagerSelect,
.dshSkillManagerTextarea {
  box-sizing: border-box;
  width: 100%;
  padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.dshSkillManagerInput,
.dshSkillManagerSelect { height: 32px; }
.dshSkillManagerSelect {
  appearance: none;
  /* Data-URI SVGs cannot resolve CSS variables; #81858C is the caption gray
     shared by both themes. */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px 12px;
  padding-right: 30px;
  cursor: pointer;
}
.dshSkillManagerTextarea {
  padding: 8px 10px;
  min-height: 96px;
  resize: vertical;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre;
  overflow-wrap: normal;
  overflow: auto;
}
.dshSkillManagerTextarea[data-size='tall'] { min-height: 260px; }
.dshSkillManagerInput::placeholder { color: var(--dsw-alias-label-dimmed); }
.dshSkillManagerInput:focus-visible,
.dshSkillManagerSelect:focus-visible,
.dshSkillManagerTextarea:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
}
.dshSkillManagerInput:disabled,
.dshSkillManagerSelect:disabled,
.dshSkillManagerTextarea:disabled { opacity: .6; cursor: default; }

.dshSkillManagerTools { display: flex; flex-direction: column; gap: 8px; }
.dshSkillManagerToolsHead { display: flex; align-items: center; gap: 8px; }
.dshSkillManagerToolsTitle {
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerToolsList {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 10px;
  overflow: hidden;
}
.dshSkillManagerTool { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; }
.dshSkillManagerTool + .dshSkillManagerTool { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dshSkillManagerToolName {
  overflow-wrap: anywhere;
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dshSkillManagerToolDesc {
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

.dshSkillManagerFooter {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
  padding-top: 12px;
}
.dshSkillManagerFooterSpacer { flex: 1; min-width: 0; }

.dshSkillManagerConfirm {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 10px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
}
.dshSkillManagerConfirmText {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}

.dshSkillManagerBtn {
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
.dshSkillManagerBtn[data-size='sm'] {
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 12px;
  line-height: 18px;
}
.dshSkillManagerBtn:disabled { opacity: .4; cursor: default; }
.dshSkillManagerBtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshSkillManagerBtn[data-variant='primary'] {
  border: none;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dshSkillManagerBtn[data-variant='primary']:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dshSkillManagerBtn[data-variant='secondary'] { border: 0.5px solid var(--dsw-alias-border-l3); }
.dshSkillManagerBtn[data-variant='secondary']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshSkillManagerBtn[data-variant='danger'] { color: var(--dsw-alias-state-error-primary); }
.dshSkillManagerBtn[data-variant='danger']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }
.dshSkillManagerBtn[data-variant='dashed'] {
  flex: 1 1 0;
  min-width: 180px;
  height: 44px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 16px;
}
.dshSkillManagerBtn[data-variant='dashed']:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }

.dshSkillManagerActions { display: flex; flex-wrap: wrap; gap: 10px; }

.dshSkillManagerTag {
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
.dshSkillManagerTag[data-tone='outline'] {
  border: 0.5px solid var(--dsw-alias-border-l4);
  color: var(--dsw-alias-label-tertiary);
}
.dshSkillManagerTag[data-tone='neutral'] {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.dshSkillManagerTag[data-tone='success'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

/* The track keys its on/off appearance off aria-checked, so the visual state
   cannot disagree with the state assistive technology reads. */
.dshSkillManagerSwitch {
  box-sizing: border-box;
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 10px;
  corner-shape: round;
  background: var(--dsw-alias-border-l3);
  cursor: pointer;
}
.dshSkillManagerSwitch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.dshSkillManagerSwitch:disabled { cursor: default; opacity: .5; }
.dshSkillManagerSwitch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshSkillManagerSwitchThumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-alias-label-primary-foreground);
  transition: transform 120ms ease;
}
.dshSkillManagerSwitch[aria-checked='true'] .dshSkillManagerSwitchThumb { transform: translateX(16px); }

.dshSkillManagerEmpty {
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
  .dshSkillManagerCard,
  .dshSkillManagerChevron,
  .dshSkillManagerBtn,
  .dshSkillManagerSwitchThumb { transition: none; }
}
`

export function installSkillManagerStyles(): () => void {
  document.getElementById(STYLE_ID)?.remove()
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.append(element)
  return () => { element.remove() }
}
