import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import {
  businessDateString,
  calendarDaysBetween,
  shiftCalendarDate,
} from '../src/lib/business-date.ts'

const nodeRequire = createRequire(import.meta.url)

test('business today changes at Karachi midnight', () => {
  assert.equal(businessDateString(new Date('2026-09-28T18:59:59Z')), '2026-09-28')
  assert.equal(businessDateString(new Date('2026-09-28T19:00:00Z')), '2026-09-29')
  assert.equal(businessDateString(new Date('2026-09-28T20:30:00Z')), '2026-09-29')
  assert.equal(businessDateString(new Date('2026-09-29T18:59:59Z')), '2026-09-29')
  assert.equal(businessDateString(new Date('2026-09-29T19:00:00Z')), '2026-09-30')
})

test('calendar-day navigation preserves explicit dates across boundaries', () => {
  assert.equal(shiftCalendarDate('2026-09-29', 0), '2026-09-29')
  assert.equal(shiftCalendarDate('2026-09-29', -7), '2026-09-22')
  assert.equal(shiftCalendarDate('2026-09-30', 1), '2026-10-01')
  assert.equal(shiftCalendarDate('2026-01-01', -1), '2025-12-31')
})

test('overdue day counts use calendar days even across host DST', () => {
  assert.equal(calendarDaysBetween('2026-03-07', '2026-03-09'), 2)
  assert.equal(calendarDaysBetween('2026-11-01', '2026-11-02'), 1)
})

test('date-only display keeps its calendar day in a negative-offset browser', () => {
  const ts = nodeRequire('typescript')
  const path = fileURLToPath(new URL('../src/lib/utils.ts', import.meta.url))
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadedModule = { exports: {} }
  runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: name => name === './business-date'
      ? { businessDateString }
      : name === './quantity' ? {} : nodeRequire(name),
    Date,
  })

  const previousZone = process.env.TZ
  try {
    process.env.TZ = 'America/Los_Angeles'
    assert.equal(loadedModule.exports.formatDate('2026-09-29'), '29 Sept 2026')
    assert.equal(loadedModule.exports.formatDate('2026-09-29T01:00:00Z'), '28 Sept 2026')
    assert.equal(loadedModule.exports.formatDateShort('2026-09-29'), '29 Sept')
    assert.equal(loadedModule.exports.formatDateShort('2026-09-29T01:00:00Z'), '28 Sept')
  } finally {
    if (previousZone === undefined) delete process.env.TZ
    else process.env.TZ = previousZone
  }
})
