import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { formatPdfPKR } from '../src/lib/pdf-money.ts'

const nodeRequire = createRequire(import.meta.url)
const { jsPDF } = nodeRequire('jspdf')
const ts = nodeRequire('typescript')
const path = fileURLToPath(new URL('../src/lib/customer-ledger-pdf.ts', import.meta.url))
const source = ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function loadLedgerPdf(pdfConstructor = jsPDF) {
  const loadedModule = { exports: {} }
  runInNewContext(source, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(name) {
      if (name === 'jspdf') return { jsPDF: pdfConstructor }
      if (name === '@/lib/utils') return {
        formatDate: value => value,
        customerTypeLabel: value => value,
      }
      if (name === '@/lib/pdf-logo') return {
        drawPdfBrandedHeader: async () => ({ dividerY: 30, rightY: 22 }),
        drawPdfHeaderRight() {},
      }
      if (name === '@/lib/pdf-money') return { formatPdfPKR }
      if (name === '@/lib/business-date') return {
        BUSINESS_TIME_ZONE: 'Asia/Karachi',
        businessDateString: () => '2026-09-29',
      }
      throw new Error(`Unexpected import: ${name}`)
    },
    Date,
  }, { filename: path })
  return loadedModule.exports
}

function entry(overrides = {}) {
  return {
    id: 'row-1', entry_type: 'sale', entry_date: '2026-09-29',
    description: 'Sale against a long valid customer order and delivery reference with signed receipt and shipment details',
    debit_paisa: 0, credit_paisa: 0, running_balance: 0,
    ...overrides,
  }
}

function measuredDoc() {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  return doc
}

test('description reserves actual amount width plus a visible gap', () => {
  const { layoutLedgerRow } = loadLedgerPdf()
  const doc = measuredDoc()
  const examples = [100, 149, 10050, 123456789, 12345678999, Number.MAX_SAFE_INTEGER]

  for (const paisa of examples) {
    for (const row of [
      entry({ debit_paisa: paisa, running_balance: paisa }),
      entry({ credit_paisa: paisa, running_balance: -paisa }),
      entry({ debit_paisa: paisa, credit_paisa: paisa, running_balance: paisa }),
    ]) {
      const layout = layoutLedgerRow(doc, row)
      const amountLeft = Math.min(...layout.amounts.map(amount => amount.left))
      assert.ok(layout.descriptionLines.length > 1, String(paisa))
      assert.equal(layout.amounts.find(amount => amount.column === (row.debit_paisa ? 'debit' : 'credit')).text, formatPdfPKR(paisa))
      assert.ok(layout.descriptionWidth > 0, String(paisa))
      assert.ok(layout.descriptionLines.every(line =>
        layout.columns.description + doc.getTextWidth(line) + layout.gap <= amountLeft + 0.01
      ), `description overlaps ${formatPdfPKR(paisa)}`)
      assert.equal(
        layout.descriptionLines.join(' ').replace(/\s+/g, ' ').trim(),
        row.description,
        'wrapped description remains complete',
      )
      assert.ok(layout.amounts.every(amount =>
        amount.left >= layout.columns.description + layout.gap &&
        amount.x <= doc.internal.pageSize.getWidth() - 20
      ), `amount outside table: ${formatPdfPKR(paisa)}`)

      for (const [index, amount] of layout.amounts.entries()) {
        for (const other of layout.amounts.slice(index + 1)) {
          if (amount.line === other.line) {
            assert.ok(
              amount.x + layout.gap <= other.left || other.x + layout.gap <= amount.left,
              `money columns overlap for ${formatPdfPKR(paisa)}`,
            )
          }
        }
      }
    }
  }
})

test('multi-line rows paginate without losing description or amount text', async () => {
  const captures = []
  function CapturingPDF(...args) {
    const doc = new jsPDF(...args)
    const text = doc.text.bind(doc)
    doc.text = (value, x, y, options) => {
      captures.push({ value, x, y, page: doc.internal.getCurrentPageInfo().pageNumber })
      return text(value, x, y, options)
    }
    doc.save = () => {}
    return doc
  }
  const { generateCustomerLedgerPDF, layoutLedgerRow } = loadLedgerPdf(CapturingPDF)
  const longRow = entry({
    id: 'long-row',
    description: 'ReviewerRow ' + 'delivery reference and signed customer order '.repeat(6).trim(),
    debit_paisa: 123456789,
    running_balance: 123456789,
  })
  const expectedLines = layoutLedgerRow(measuredDoc(), longRow).descriptionLines
  assert.ok(expectedLines.length > 2)

  await generateCustomerLedgerPDF(
    { contact_name: 'Layout Test Customer' },
    {
      ledger: [
        ...Array.from({ length: 24 }, (_, i) => entry({
          id: `short-${i}`, description: `Short row ${i}`,
        })),
        longRow,
      ],
      summary: {
        total_debit_paisa: 123456789,
        total_credit_paisa: 0,
        closing_balance: 123456789,
      },
    },
  )

  const firstLine = captures.find(call => call.value === expectedLines[0])
  assert.ok(firstLine)
  assert.equal(firstLine.page, 2)
  for (const line of expectedLines) {
    assert.ok(captures.some(call => call.value === line && call.page === firstLine.page), `missing row line: ${line}`)
  }
  assert.ok(captures.some(call =>
    call.value === formatPdfPKR(longRow.debit_paisa) &&
    call.page === firstLine.page &&
    call.y === firstLine.y
  ), 'debit and first description line stay together')

  captures.length = 0
  const spanningRow = entry({
    id: 'spanning-row',
    description: Array.from({ length: 500 }, (_, index) => `signed-carton-${index}`).join(' '),
    credit_paisa: 12345678999,
    running_balance: -12345678999,
  })
  const spanningLines = layoutLedgerRow(measuredDoc(), spanningRow).descriptionLines
  assert.ok(spanningLines.length > 60)
  await generateCustomerLedgerPDF(
    { contact_name: 'Layout Test Customer' },
    {
      ledger: [spanningRow],
      summary: {
        total_debit_paisa: 0,
        total_credit_paisa: 12345678999,
        closing_balance: -12345678999,
      },
    },
  )
  const drawnDescription = captures.filter(call => spanningLines.includes(call.value))
  assert.deepEqual(drawnDescription.map(call => call.value), spanningLines)
  assert.ok(new Set(drawnDescription.map(call => call.page)).size > 1)
  assert.ok(drawnDescription.every(call => call.y <= 255))
  assert.ok(captures.some(call =>
    call.value === formatPdfPKR(spanningRow.credit_paisa) &&
    call.page === drawnDescription[0].page &&
    call.y === drawnDescription[0].y
  ), 'credit and first description line stay together')
})
