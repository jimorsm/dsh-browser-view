/**
 * Where the host gets rrweb's recorder from at runtime.
 *
 * The published artifact carries a copy of the bundle next to the host half
 * (`lib/rrweb.umd.cjs`, copied by `build/copy-mirror.mjs` at build time), and
 * this module reads exactly that file. The alternative — resolving
 * `node_modules/rrweb/dist/rrweb.umd.cjs` at runtime — cannot be made correct:
 * the host runs from a dsh profile tree whose install layout is not this
 * repository's, a bundled or hoisted dependency may sit somewhere else
 * entirely, and a plugin that guesses a path works until the one day it does
 * not. A file shipped beside the code it belongs to has no such day.
 *
 * Read lazily and cached: a host that never opens a browser view never reads a
 * megabyte of recorder, and the failure — when it comes — names the artifact
 * and the build step that should have produced it.
 *
 * @module @jimorsm/dsh-client-ui-browser-view/host/mirror-source
 */
/** Name of the copied recorder, as it sits beside the host half in `lib/`. */
export declare const MIRROR_SOURCE_ARTIFACT = "rrweb.umd.cjs";
/**
 * The recorder bundle to inject, as source text.
 * @returns rrweb's UMD build.
 * @throws Error naming the artifact and the build step when it is missing.
 */
export declare function readMirrorSource(): string;
/** Forget the cached bundle. Test seam only: the process never reloads it. */
export declare function resetMirrorSourceCache(): void;
