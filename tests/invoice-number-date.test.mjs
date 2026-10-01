import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { businessDateString } from '../src/lib/business-date.ts'

const nodeRequire = createRequire(import.meta.url)
const utilsPath = fileURLToPath(new URL('../src/lib/utils.ts', import.meta.url))
const utilsCode = nodeRequire('typescript').transpileModule(readFileSync(utilsPath, 'utf8'), {
  compilerOptions: {
    module: nodeRequire('typescript').ModuleKind.CommonJS,
    target: nodeRequire('typescript').ScriptTarget.ES2022,
  },
}).outputText

function invoiceGeneratorAt(instant, random = 0.425) {
  const loadedModule = { exports: {} }
  const math = Object.create(Math)
  math.random = () => random
  runInNewContext(utilsCode, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: name => name === './business-date'
      ? { businessDateString: () => businessDateString(new Date(instant)) }
      : name === './quantity' ? {} : name === './exact-money' ? nodeRequire('../src/lib/exact-money.ts') : nodeRequire(name),
    Math: math,
  })
  return loadedModule.exports.generateInvoiceNumber
}

test('invoice number uses Karachi calendar date across midnight in every machine timezone', () => {
  const previousZone = process.env.TZ
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = zone
      for (const [instant, expectedDate] of [
        ['2026-09-28T18:59:59Z', '20260928'],
        ['2026-09-28T19:00:00Z', '20260929'],
        ['2026-09-28T20:30:00Z', '20260929'],
      ]) {
        const generateInvoiceNumber = invoiceGeneratorAt(instant)
        assert.equal(generateInvoiceNumber('SAL'), `SAL-${expectedDate}-482`)
        assert.equal(generateInvoiceNumber('PUR'), `PUR-${expectedDate}-482`)
      }
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ
    else process.env.TZ = previousZone
  }
})

test('invoice number keeps its three-digit random suffix', () => {
  assert.equal(invoiceGeneratorAt('2026-09-28T20:30:00Z', 0)('SAL'), 'SAL-20260929-100')
  assert.equal(invoiceGeneratorAt('2026-09-28T20:30:00Z', 0.999)('PUR'), 'PUR-20260929-999')
})
