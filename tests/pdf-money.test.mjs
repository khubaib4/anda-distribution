import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPdfPKR } from '../src/lib/pdf-money.ts'

test('PDF money shows exact paisa and clean whole rupees', () => {
  const cases = [
    [0, 'Rs. 0'],
    [1, 'Rs. 0.01'],
    [51, 'Rs. 0.51'],
    [98, 'Rs. 0.98'],
    [100, 'Rs. 1'],
    [149, 'Rs. 1.49'],
    [10050, 'Rs. 100.50'],
    [123456789, 'Rs. 12,34,567.89'],
    [-149, 'Rs. -1.49'],
    [Number.MAX_SAFE_INTEGER, 'Rs. 9,00,71,99,25,47,409.91'],
  ]

  for (const [paisa, expected] of cases) {
    assert.equal(formatPdfPKR(paisa), expected, String(paisa) + ' paisa')
  }
})
