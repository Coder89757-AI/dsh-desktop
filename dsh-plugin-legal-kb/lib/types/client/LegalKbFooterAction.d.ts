/** Legal-KB sidebar footer entry: connection panel launcher. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { LegalKbApi } from './legal-kb-api.ts';
/** Registration-side capabilities for the Legal-KB entry. */
export interface LegalKbFooterActionInjected {
    readonly api: LegalKbApi;
}
/** Renderer-composed Legal-KB footer action props. */
export type LegalKbFooterActionProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'legal-kb'> & InjectFace<LegalKbFooterActionInjected>;
/** Render the sidebar footer launcher and its connection panel. */
export declare function LegalKbFooterAction({ api, t, wide }: LegalKbFooterActionProps): import("react").JSX.Element;
