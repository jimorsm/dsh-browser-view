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
 */
import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@jimorsm/dsh-client-ui-browser-view', ['src/index.ts'])
