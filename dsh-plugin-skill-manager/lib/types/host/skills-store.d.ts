/** Skill inventory and lifecycle over the same filesystem layout the upstream
 * skill-filesystem provider discovers.
 *
 * Scopes: `system` skills ship with the application (bundled root), `user`
 * skills live under `$DSH_HOME/skills` and `$DSH_AGENTS_HOME/skills`.
 *
 * Enable/disable uses a `.disabled` shadow directory per root: discovery only
 * scans the top level of each root, so entries moved one level deeper become
 * invisible to the provider, and the chokidar watcher refreshes the catalog
 * live. Bundled skills are application-owned and cannot be moved; disabling
 * one instead writes a same-named inert "shadow" user skill — user roots
 * outrank the bundled root in the registry's duplicate arbitration, and the
 * shadow's frontmatter turns off both model and user invocation. */
import type { SkillEntry } from './contract.ts';
export declare class SkillsStoreError extends Error {
    constructor(message: string);
}
interface ParsedSkillFile {
    readonly name: string;
    readonly description: string;
    readonly shadow: boolean;
}
interface SkillRoot {
    readonly path: string;
    readonly scope: 'system' | 'user';
    readonly skipSystem: boolean;
}
/** Filesystem-backed skill inventory and lifecycle operations. */
export declare class SkillsStore {
    private readonly userDshRoot;
    private readonly userAgentsRoot;
    private readonly bundledRoot;
    constructor();
    /** Roots to expose in the panel. Bundled first so system skills read top-down. */
    roots(): SkillRoot[];
    list(): SkillEntry[];
    toggle(name: string, scope: 'system' | 'user', enabled: boolean): Promise<void>;
    save(name: string, content: string): Promise<void>;
    remove(name: string): Promise<void>;
    importFrom(sourceDir: string): Promise<string[]>;
    read(name: string, scope: 'system' | 'user'): {
        content: string;
        readOnly: boolean;
    };
    private toggleSystem;
    private isShadow;
    private isShadowPath;
    private leafName;
    private containingRoot;
    private assertUnderRoot;
    private isUnder;
    private moveWithinRoot;
    private discoverRoot;
}
/** Minimal frontmatter reader aligned with the upstream provider's rules:
 * a leading `---` block with string `name` and `description`. */
export declare function parseSkillFileContent(raw: string): ParsedSkillFile | undefined;
/** Exposed for tests: the user roots this store manages. */
export declare function managedUserRoots(): readonly string[];
export {};
