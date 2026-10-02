import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')

// Load real application helpers/components in Node tests without network access.
export function typescriptLoader(overrides = {}, globals = {}) {
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports
    const loadedModule = { exports: {} }; modules.set(path, loadedModule)
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText
    runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, Date, URL, console, ...globals,
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name]
        if (name === 'server-only' || name.endsWith('.css')) return {}
        if (name.startsWith('@/') || name.startsWith('.')) {
          const base = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(path), name)
          return load(['.ts', '.tsx'].map(ext => base + ext).find(existsSync))
        }
        return require(name)
      },
    }, { filename: path })
    return loadedModule.exports
  }
  return path => load(resolve(root, path))
}
