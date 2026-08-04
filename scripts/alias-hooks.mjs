// Resolves the '@shared/*' alias for harnesses that import the TypeScript
// sources directly.
//
// electron-vite rewrites this alias at build time and tsc knows it from
// tsconfig paths, but plain Node knows neither — so a harness that imports
// src/main/runner.ts fails on its first '@shared/content' import. Node's
// package "imports" field cannot express it either, since those keys must
// start with '#'.
//
// Used via: node --import ./scripts/alias-register.mjs <harness>
import { pathToFileURL } from 'node:url'
import { join, resolve as resolvePath } from 'node:path'

const SHARED = resolvePath(import.meta.dirname, '..', 'src', 'shared')

// Async because next() returns a promise — a synchronous try/catch around it
// never sees the rejection, and the fallback below silently does nothing.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@shared/')) {
    const rest = specifier.slice('@shared/'.length)
    // The sources are .ts and the alias is written without an extension.
    const file = rest.endsWith('.ts') ? rest : `${rest}.ts`
    return next(pathToFileURL(join(SHARED, file)).href, context)
  }

  // TypeScript allows extensionless relative imports ("./human"); Node ESM
  // requires the extension. Only reached once the plain resolution has failed,
  // so nothing that already works is affected.
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(specifier, context)
    } catch {
      return await next(`${specifier}.ts`, context)
    }
  }

  return next(specifier, context)
}
