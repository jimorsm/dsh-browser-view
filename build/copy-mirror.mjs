/**
 * Copy rrweb's UMD build into the published artifacts.
 *
 * The host injects this file into the watched page, so it has to travel with
 * the host half: `lib/index.js` reads `lib/rrweb.umd.cjs` beside itself (see
 * src/host/mirror-source.ts) and never resolves a node_modules path at runtime.
 * A build step rather than a `files` entry because npm's `files` can only
 * include what is already inside the package directory, and `node_modules` is
 * never published.
 *
 * Run from `pnpm build`, after tsdown, so the artifact always matches the
 * dependency the manifest declares.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/**
 * The installed rrweb package directory.
 *
 * Not `require.resolve('rrweb/package.json')`: rrweb's `exports` map does not
 * expose its manifest, so that path is refused. Resolving the entry point and
 * walking up to the manifest that names the package is what works whether the
 * package manager hoisted it, nested it or linked it.
 * @param entry - absolute path the resolver returned for `rrweb`.
 * @returns the package directory, or null when no manifest names it.
 */
function packageRootOf(entry) {
  let dir = dirname(entry)
  for (;;) {
    const manifest = resolve(dir, 'package.json')
    if (existsSync(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === 'rrweb') return dir
      } catch {
        // An unreadable manifest is not the one being looked for.
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const packageRoot = packageRootOf(require.resolve('rrweb'))
if (packageRoot === null) {
  console.error('copy-mirror: could not find the installed rrweb package; run `pnpm install`')
  process.exit(1)
}
const source = resolve(packageRoot, 'dist', 'rrweb.umd.cjs')
const target = resolve(root, 'lib', 'rrweb.umd.cjs')

if (!existsSync(source)) {
  console.error(`copy-mirror: rrweb's UMD build is missing at ${source}; run \`pnpm install\``)
  process.exit(1)
}
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
const { size } = statSync(target)
if (size === 0) {
  console.error(`copy-mirror: copied ${target} but it is empty`)
  process.exit(1)
}
console.log(`copy-mirror: lib/rrweb.umd.cjs (${size} bytes) from rrweb`)
