/** Legal-KB sidebar entry registration for the Desktop client bundle. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type LegalKbLocaleKey } from './legal-kb-locales.ts';
/** Locale namespace owned by the Legal-KB entry. */
export declare const LEGAL_KB_LOCALE_NAMESPACE = "legal-kb";
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Legal-KB sidebar entry copy. */
        'legal-kb': LegalKbLocaleKey;
    }
}
/** Register the Legal-KB entry in the sidebar footer action list slot. */
export declare function applyLegalKb(ctx: ClientContext): void;
