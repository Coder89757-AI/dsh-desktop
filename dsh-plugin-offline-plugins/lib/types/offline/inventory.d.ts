/** Profile plugin inventory: manifest bundles resolved against the Profile's
 * node_modules, including package versions and the dependency closure used by
 * exports. */
import type { OfflinePluginEntry } from './contract.ts';
/** Build-time-only dependencies that never need to travel with an export:
 * they are consumed when compiling native addons, not at plugin load time. */
export declare const EXPORT_EXCLUDED_PACKAGES: ReadonlySet<string>;
/** Bundles that ship with the application itself and are never exportable. */
export declare const IMMUTABLE_BUNDLE_NAMES: ReadonlySet<string>;
export declare function isValidPackageName(name: string): boolean;
interface ProfileManifest {
    readonly bundles: readonly string[];
}
/** Read the active Profile manifest's declared bundle names. */
export declare function readProfileManifest(profileDir: string): ProfileManifest;
/** Real on-disk directory for one installed package, following pnpm links. */
export declare function installedPackageDir(profileDir: string, name: string): string | undefined;
/** Depth-first dependency closure of one installed package, keyed by name.
 * `requirements` collects, per dependency, every semver range its in-tree
 * dependents declared — import uses it to decide whether an already-installed
 * top-level version can be reused instead of copied. */
export declare function dependencyClosure(profileDir: string, rootName: string): {
    readonly packages: ReadonlyMap<string, string>;
    readonly requirements: ReadonlyMap<string, readonly string[]>;
    readonly excluded: readonly string[];
    readonly unresolved: readonly string[];
};
/** Every installed Profile plugin visible to the management panel.
 * `mutableNames` and `disabledNames` come from the Desktop plugin-management
 * service; names it does not know fall back to the launcher-owned set. */
export declare function listInstalledPlugins(profileDir: string, mutableNames: ReadonlySet<string>, disabledNames: ReadonlySet<string>): readonly OfflinePluginEntry[];
export {};
