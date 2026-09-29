import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isPositiveWholeEggCount,
  wholeEggsFromTrays,
  wholeEggsFromWholeTrays,
} from '../src/lib/quantity.ts'

test('egg input requires a positive safe integer number', () => {
  assert.equal(isPositiveWholeEggCount(1), true)
  assert.equal(isPositiveWholeEggCount(Number.MAX_SAFE_INTEGER), true)

  for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, '1', null, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isPositiveWholeEggCount(value), false, String(value))
  }
})

test('manual tray input accepts only whole physical eggs', () => {
  assert.equal(wholeEggsFromTrays(1), 30)
  assert.equal(wholeEggsFromTrays(0.5), 15)
  assert.equal(wholeEggsFromTrays(0.1), 3)
  assert.equal(wholeEggsFromTrays(1 / 30), 1)
  assert.equal(wholeEggsFromTrays(31 / 30), 31)
  assert.equal(wholeEggsFromTrays(1 / 30 + 1e-12), 1)

  for (const value of [0, -1, 0.01, 1 / 30 + 1e-9, NaN, Infinity, -Infinity, '0.5', null, true, Number.MAX_SAFE_INTEGER]) {
    assert.equal(wholeEggsFromTrays(value), null, String(value))
  }
})

test('sale and purchase quantities remain positive whole trays', () => {
  assert.equal(wholeEggsFromWholeTrays(1), 30)
  assert.equal(wholeEggsFromWholeTrays(12), 360)

  for (const value of [0, -1, 0.5, 1 / 30, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER]) {
    assert.equal(wholeEggsFromWholeTrays(value), null, String(value))
  }
})
