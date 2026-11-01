/**
 * Standalone tsdown config for the browser-view plugin.
 *
 * Uses the repository-local client-bundle preset (build/tsdown.client.ts - a
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table). The node half builds
 * from src (tsdown compiles TS directly) and types ship from lib/types (tsc).
 *
 * The preset is vendored from the upstream dsh-web monorepo (shared/) so this
 * repository builds without a checkout of that monorepo; see NOTICE.
 *
 * One thing is added on top of the preset here rather than in the vendored file:
 * `inlineDynamicImports` for the client bundle. The panel loads rrweb's replayer
 * through a dynamic import, and rolldown's default for that is a second emitted
 * chunk - which a closure-factory artifact cannot load, because the loader hands
 * the factory a `require` bound to its module table and never a filesystem. The
 * client half must therefore stay exactly one file, whatever it imports.
 */
import type { UserConfig } from 'tsdown'
import { clientBundle } from './build/tsdown.client.ts'

const base = clientBundle('@jimorsm/dsh-client-ui-browser-view', ['src/index.ts'])

/** The preset's configs, with the client bundle pinned to a single file. */
export default (inlineConfig: Pick<UserConfig, 'env'>): UserConfig[] =>
  base(inlineConfig).map(config =>
    typeof config.name === 'string' && config.name.endsWith('/client')
      ? { ...config, outputOptions: { ...config.outputOptions, inlineDynamicImports: true } }
      : config)
