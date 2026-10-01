import { jsPDF } from 'jspdf'
import { formatDate, customerTypeLabel } from '@/lib/utils'
import { drawPdfBrandedHeader, drawPdfHeaderRight } from '@/lib/pdf-logo'
import { formatPdfPKR } from '@/lib/pdf-money'
import { BUSINESS_TIME_ZONE, businessDateString } from '@/lib/business-date'
import type { CustomerBalance } from '@/types'

export interface LedgerEntry {
  id:              string
  entry_type:      'sale' | 'payment' | 'opening' | 'opening_correction' | 'advance_applied' | 'allocation_released' | 'payment_allocated'
  entry_date:      string
  description:     string
  debit_paisa:     number
  credit_paisa:    number
  running_balance: number
  invoice_number?: string
  payment_method?: string
  details?: { amount_paisa?: number } | null
}

export interface LedgerData {
  ledger:  LedgerEntry[]
  summary: {
    total_debit_paisa:  number
    total_credit_paisa: number
    closing_balance:    number
    accounts_enabled?: boolean
    total_sales_paisa?: number
    total_paid_paisa?: number
    due_paisa?: number
    advance_paisa?: number
    opening_balance?: import('@/types').CustomerOpeningBalance | null
  }
}

const LEDGER_MARGIN = 20
const LEDGER_TEXT_SIZE = 8
const LEDGER_LINE_HEIGHT = 4
const LEDGER_AMOUNT_GAP = 3
const LEDGER_LAST_BASELINE = 255
const LEDGER_PAGE_TOP = 20
const LEDGER_HEADER_HEIGHT = 9

function ledgerColumns(pageWidth: number, margin: number) {
  return {
    date: margin,
    description: margin + 24,
    debit: pageWidth - margin - 58,
    credit: pageWidth - margin - 38,
    balance: pageWidth - margin,
  }
}

/** Measure the actual row text before deciding how much room the description gets. */
export function layoutLedgerRow(doc: jsPDF, entry: LedgerEntry, margin = LEDGER_MARGIN) {
  const columns = ledgerColumns(doc.internal.pageSize.getWidth(), margin)
  const balanceColor =
    entry.running_balance > 0 ? 'danger'
    : entry.running_balance < 0 ? 'success'
    : 'neutral'
  const balanceAmount = pdfAmount(Math.abs(entry.running_balance), balanceColor)
  const candidates = [
    entry.debit_paisa > 0
      ? { column: 'debit' as const, ...pdfAmount(entry.debit_paisa, 'danger') }
      : null,
    entry.credit_paisa > 0
      ? { column: 'credit' as const, ...pdfAmount(entry.credit_paisa, 'success') }
      : null,
    {
      column: 'balance' as const,
      ...balanceAmount,
      text: entry.running_balance === 0 ? '—' : balanceAmount.text,
    },
  ].filter(item => item !== null)

  const amounts: Array<(typeof candidates)[number] & {
    x: number
    left: number
    line: number
  }> = []
  for (const amount of candidates) {
    const x = columns[amount.column]
    const left = x - doc.getTextWidth(amount.text)
    let line = 0
    while (amounts.some(other =>
      other.line === line &&
      left < other.x + LEDGER_AMOUNT_GAP &&
      other.left < x + LEDGER_AMOUNT_GAP
    )) {
      line++
    }
    amounts.push({ ...amount, x, left, line })
  }

  const amountLeft = Math.min(...amounts.map(amount => amount.left))
  const descriptionWidth = amountLeft - columns.description - LEDGER_AMOUNT_GAP
  const descriptionLines = doc.splitTextToSize(entry.description + (entry.details?.amount_paisa ? ` — ${formatPdfPKR(entry.details.amount_paisa)}` : ''), descriptionWidth) as string[]
  const lineCount = Math.max(
    1,
    descriptionLines.length,
    ...amounts.map(amount => amount.line + 1),
  )

  return { columns, amounts, descriptionWidth, descriptionLines, lineCount, gap: LEDGER_AMOUNT_GAP }
}

function pdfAmount(
  paisa: number,
  color: 'danger' | 'success' | 'neutral',
): { text: string; r: number; g: number; b: number } {
  const colors = {
    danger:  { r: 185, g: 28,  b: 28  },
    success: { r: 22,  g: 163, b: 74  },
    neutral: { r: 68,  g: 64,  b: 60  },
  }
  return { text: formatPdfPKR(paisa), ...colors[color] }
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-PK', {
    timeZone: BUSINESS_TIME_ZONE,
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  })
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_+/g, '_')
}

export async function generateCustomerLedgerPDF(
  customer: CustomerBalance,
  ledgerData: LedgerData,
  logoUrl?: string | null,
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin    = LEDGER_MARGIN
  let y           = 22

  const generatedDate = todayLabel()

  const headerLayout = await drawPdfBrandedHeader(doc, {
    margin,
    pageWidth,
    y,
    logoUrl,
    title:    "Doctor's Egg",
    subtitle: 'Karachi, Pakistan',
  })

  drawPdfHeaderRight(doc, pageWidth, margin, headerLayout.rightY, [
    'Customer Statement',
    `Generated: ${generatedDate}`,
  ])

  y = headerLayout.dividerY
  doc.setLineWidth(0.4)
  doc.line(margin, y, pageWidth - margin, y)
  y += 10

  doc.setFillColor(248, 248, 247)
  doc.roundedRect(margin, y, pageWidth - 2 * margin, 28, 2, 2, 'F')
  y += 7

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text('CUSTOMER', margin + 4, y)
  y += 6

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  const infoLines: string[] = [
    `Name: ${customer.contact_name}`,
  ]
  if (customer.business_name) {
    infoLines.push(`Business: ${customer.business_name}`)
  }
  if (customer.phone) {
    infoLines.push(`Phone: ${customer.phone}`)
  }
  if (customer.customer_type) {
    infoLines.push(`Type: ${customerTypeLabel(customer.customer_type)}`)
  }

  for (const line of infoLines) {
    doc.text(line, margin + 4, y)
    y += 5
  }

  y += 8

  const summaryY = y
  const accountEnabled = ledgerData.summary.accounts_enabled
  const boxWidth = (pageWidth - 2 * margin - (accountEnabled ? 12 : 8)) / (accountEnabled ? 4 : 3)
  const balance  = ledgerData.summary.closing_balance
  const summaryItems = [
    {
      label: 'Total Sales',
      value: ledgerData.summary.total_sales_paisa ?? ledgerData.summary.total_debit_paisa,
      color: 'neutral' as const,
    },
    {
      label: accountEnabled ? 'Total Received' : 'Total Paid',
      value: ledgerData.summary.total_paid_paisa ?? ledgerData.summary.total_credit_paisa,
      color: 'success' as const,
    },
    {
      label: accountEnabled ? 'Balance Due' : balance > 0 ? 'Balance Due' : balance < 0 ? 'Advance' : 'Balance Due',
      value: ledgerData.summary.due_paisa ?? Math.abs(balance),
      color: (ledgerData.summary.due_paisa ?? balance) > 0 ? 'danger' as const : 'success' as const,
    },
  ]
  if (accountEnabled) summaryItems.push({ label: 'Available Advance', value: ledgerData.summary.advance_paisa ?? 0, color: 'success' })

  summaryItems.forEach((item, index) => {
    const x = margin + index * (boxWidth + 4)
    doc.setFillColor(245, 245, 244)
    doc.roundedRect(x, summaryY, boxWidth, 22, 2, 2, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(item.label, x + 4, summaryY + 7)

    const amount = pdfAmount(item.value, item.color)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    if (doc.getTextWidth(amount.text) > boxWidth - 8) {
      doc.setFontSize(9)
    }
    doc.setTextColor(amount.r, amount.g, amount.b)
    doc.text(amount.text, x + 4, summaryY + 16)
    doc.setTextColor(0, 0, 0)
  })

  y = summaryY + 30

  if (accountEnabled && ledgerData.summary.opening_balance) {
    const opening = ledgerData.summary.opening_balance
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`Previous ${opening.balance_type}: ${formatPdfPKR(opening.amount_paisa)} (${formatDate(opening.entry_date)})`, margin, y)
    y += 10
  }

  const columns = ledgerColumns(pageWidth, margin)

  function drawTableHeader() {
    doc.setFillColor(245, 245, 244)
    doc.rect(margin, y - 5, pageWidth - 2 * margin, 9, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(80, 80, 80)
    doc.text('Date', columns.date, y)
    doc.text('Description', columns.description, y)
    doc.text('Debit', columns.debit, y, { align: 'right' })
    doc.text('Credit', columns.credit, y, { align: 'right' })
    doc.text(accountEnabled ? 'Net balance' : 'Balance', columns.balance, y, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    y += LEDGER_HEADER_HEIGHT
  }

  drawTableHeader()

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(LEDGER_TEXT_SIZE)

  ledgerData.ledger.forEach((entry, index) => {
    const row = layoutLedgerRow(doc, entry, margin)
    const fullPageLines = Math.floor(
      (LEDGER_LAST_BASELINE - LEDGER_PAGE_TOP - LEDGER_HEADER_HEIGHT) / LEDGER_LINE_HEIGHT,
    ) + 1
    if (
      y + (row.lineCount - 1) * LEDGER_LINE_HEIGHT > LEDGER_LAST_BASELINE &&
      (row.lineCount <= fullPageLines || y > LEDGER_PAGE_TOP + LEDGER_HEADER_HEIGHT)
    ) {
      doc.addPage()
      y = LEDGER_PAGE_TOP
      drawTableHeader()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(LEDGER_TEXT_SIZE)
    }

    let firstLine = 0
    while (firstLine < row.lineCount) {
      const linesOnPage = Math.min(
        row.lineCount - firstLine,
        Math.floor((LEDGER_LAST_BASELINE - y) / LEDGER_LINE_HEIGHT) + 1,
      )

      if (index % 2 === 1) {
        doc.setFillColor(252, 252, 251)
        doc.rect(
          margin,
          y - 4,
          pageWidth - 2 * margin,
          8 + (linesOnPage - 1) * LEDGER_LINE_HEIGHT,
          'F',
        )
      }

      if (firstLine === 0) {
        doc.setTextColor(100, 100, 100)
        doc.text(formatDate(entry.entry_date), columns.date, y)
      }
      doc.setTextColor(0, 0, 0)
      for (let line = 0; line < linesOnPage; line++) {
        const description = row.descriptionLines[firstLine + line]
        if (description) {
          doc.text(description, columns.description, y + line * LEDGER_LINE_HEIGHT)
        }
      }
      for (const amount of row.amounts) {
        if (amount.line >= firstLine && amount.line < firstLine + linesOnPage) {
          doc.setTextColor(amount.r, amount.g, amount.b)
          doc.text(
            amount.text,
            amount.x,
            y + (amount.line - firstLine) * LEDGER_LINE_HEIGHT,
            { align: 'right' },
          )
        }
      }
      doc.setTextColor(0, 0, 0)

      y += 6 + (linesOnPage - 1) * LEDGER_LINE_HEIGHT
      firstLine += linesOnPage
      if (firstLine < row.lineCount) {
        doc.addPage()
        y = LEDGER_PAGE_TOP
        drawTableHeader()
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(LEDGER_TEXT_SIZE)
      }
    }
  })

  y += 2
  if (y > 240) {
    doc.addPage()
    y = 20
  }
  doc.setLineWidth(0.4)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  doc.setFillColor(245, 245, 244)
  doc.rect(margin, y - 5, pageWidth - 2 * margin, 24, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const closingDebit = pdfAmount(ledgerData.summary.total_debit_paisa, 'danger')
  const closingCredit = pdfAmount(
    ledgerData.summary.total_credit_paisa,
    'success',
  )
  const closingBalColor =
    balance > 0 ? 'danger' : balance < 0 ? 'success' : 'neutral'
  const closingBal = pdfAmount(Math.abs(balance), closingBalColor)
  const closingRows = [
    { label: accountEnabled ? 'TOTAL DEBITS' : 'TOTAL SALES', amount: closingDebit.text, color: closingDebit },
    { label: accountEnabled ? 'TOTAL CREDITS' : 'TOTAL PAID', amount: closingCredit.text, color: closingCredit },
    {
      label: accountEnabled ? (balance < 0 ? 'NET CREDIT' : 'NET BALANCE') : balance < 0 ? 'ADVANCE' : 'CLOSING BALANCE',
      amount: balance === 0 ? 'Settled' : closingBal.text,
      color: closingBal,
    },
  ]
  closingRows.forEach((row, index) => {
    const rowY = y + index * 7
    doc.setTextColor(0, 0, 0)
    doc.text(row.label, columns.description, rowY)
    doc.setTextColor(row.color.r, row.color.g, row.color.b)
    doc.text(row.amount, columns.balance, rowY, { align: 'right' })
  })
  doc.setTextColor(0, 0, 0)

  y += 32
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(120, 120, 120)
  doc.text(`Generated on ${generatedDate}`, pageWidth / 2, y, { align: 'center' })
  y += 6
  doc.text(
    "Doctor's Egg Management System",
    pageWidth / 2,
    y,
    { align: 'center' },
  )

  const dateSlug = businessDateString()
  const filename = `statement_${safeFilename(customer.contact_name)}_${dateSlug}.pdf`
  doc.save(filename)
}
