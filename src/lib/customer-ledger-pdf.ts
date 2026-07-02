import { jsPDF } from 'jspdf'
import { formatPKR, formatDate, customerTypeLabel } from '@/lib/utils'
import type { CustomerBalance } from '@/types'

export interface LedgerEntry {
  id:              string
  entry_type:      'sale' | 'payment'
  entry_date:      string
  description:     string
  debit_paisa:     number
  credit_paisa:    number
  running_balance: number
  invoice_number?: string
  payment_method?: string
}

export interface LedgerData {
  ledger:  LedgerEntry[]
  summary: {
    total_debit_paisa:  number
    total_credit_paisa: number
    closing_balance:    number
  }
}

function pdfPKR(paisa: number): string {
  return formatPKR(paisa).replace('₨', 'Rs.').replace(/\u00A0/g, ' ')
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
  return { text: pdfPKR(paisa), ...colors[color] }
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-PK', {
    day:   'numeric',
    month: 'long',
    year:  'numeric',
  })
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_').replace(/_+/g, '_')
}

export function generateCustomerLedgerPDF(
  customer: CustomerBalance,
  ledgerData: LedgerData,
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin    = 20
  let y           = 22

  const generatedDate = todayLabel()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text("Doctor's Egg", margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Karachi, Pakistan', margin, y + 8)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Customer Statement', pageWidth - margin, y, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 100, 100)
  doc.text(`Generated: ${generatedDate}`, pageWidth - margin, y + 8, {
    align: 'right',
  })
  doc.setTextColor(0, 0, 0)

  y += 22
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
  const boxWidth = (pageWidth - 2 * margin - 8) / 3
  const balance  = ledgerData.summary.closing_balance
  const summaryItems = [
    {
      label: 'Total Sales',
      value: ledgerData.summary.total_debit_paisa,
      color: 'neutral' as const,
    },
    {
      label: 'Total Paid',
      value: ledgerData.summary.total_credit_paisa,
      color: 'success' as const,
    },
    {
      label: balance > 0 ? 'Balance Due' : balance < 0 ? 'Advance' : 'Balance Due',
      value: Math.abs(balance),
      color: balance > 0 ? 'danger' as const : 'success' as const,
    },
  ]

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
    doc.setTextColor(amount.r, amount.g, amount.b)
    doc.text(amount.text, x + 4, summaryY + 16)
    doc.setTextColor(0, 0, 0)
  })

  y = summaryY + 30

  const colDate   = margin
  const colDesc   = margin + 24
  const colDebit  = pageWidth - margin - 58
  const colCredit = pageWidth - margin - 38
  const colBal    = pageWidth - margin

  function drawTableHeader() {
    doc.setFillColor(245, 245, 244)
    doc.rect(margin, y - 5, pageWidth - 2 * margin, 9, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(80, 80, 80)
    doc.text('Date', colDate, y)
    doc.text('Description', colDesc, y)
    doc.text('Debit', colDebit, y, { align: 'right' })
    doc.text('Credit', colCredit, y, { align: 'right' })
    doc.text('Balance', colBal, y, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    y += 9
  }

  drawTableHeader()

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)

  ledgerData.ledger.forEach((entry, index) => {
    if (y > 255) {
      doc.addPage()
      y = 20
      drawTableHeader()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
    }

    if (index % 2 === 1) {
      doc.setFillColor(252, 252, 251)
      doc.rect(margin, y - 4, pageWidth - 2 * margin, 8, 'F')
    }

    doc.setTextColor(100, 100, 100)
    doc.text(formatDate(entry.entry_date), colDate, y)

    doc.setTextColor(0, 0, 0)
    const descLines = doc.splitTextToSize(
      entry.description,
      colDebit - colDesc - 4,
    )
    doc.text(descLines[0], colDesc, y)
    const extraLines = descLines.length - 1

    if (entry.debit_paisa > 0) {
      const amt = pdfAmount(entry.debit_paisa, 'danger')
      doc.setTextColor(amt.r, amt.g, amt.b)
      doc.text(amt.text, colDebit, y, { align: 'right' })
    }

    if (entry.credit_paisa > 0) {
      const amt = pdfAmount(entry.credit_paisa, 'success')
      doc.setTextColor(amt.r, amt.g, amt.b)
      doc.text(amt.text, colCredit, y, { align: 'right' })
    }

    const balColor =
      entry.running_balance > 0 ? 'danger'
      : entry.running_balance < 0 ? 'success'
      : 'neutral'
    const balAmt = pdfAmount(Math.abs(entry.running_balance), balColor)
    doc.setTextColor(balAmt.r, balAmt.g, balAmt.b)
    doc.text(
      entry.running_balance === 0 ? '—' : balAmt.text,
      colBal,
      y,
      { align: 'right' },
    )
    doc.setTextColor(0, 0, 0)

    y += 6 + extraLines * 4
  })

  y += 2
  doc.setLineWidth(0.4)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  doc.setFillColor(245, 245, 244)
  doc.rect(margin, y - 5, pageWidth - 2 * margin, 10, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('CLOSING BALANCE', colDesc, y)

  const closingDebit = pdfAmount(ledgerData.summary.total_debit_paisa, 'danger')
  doc.setTextColor(closingDebit.r, closingDebit.g, closingDebit.b)
  doc.text(closingDebit.text, colDebit, y, { align: 'right' })

  const closingCredit = pdfAmount(
    ledgerData.summary.total_credit_paisa,
    'success',
  )
  doc.setTextColor(closingCredit.r, closingCredit.g, closingCredit.b)
  doc.text(closingCredit.text, colCredit, y, { align: 'right' })

  const closingBalColor =
    balance > 0 ? 'danger' : balance < 0 ? 'success' : 'neutral'
  const closingBal = pdfAmount(Math.abs(balance), closingBalColor)
  doc.setTextColor(closingBal.r, closingBal.g, closingBal.b)
  doc.text(
    balance === 0 ? 'Settled' : closingBal.text,
    colBal,
    y,
    { align: 'right' },
  )
  doc.setTextColor(0, 0, 0)

  y += 18
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

  const dateSlug = new Date().toISOString().split('T')[0]
  const filename = `statement_${safeFilename(customer.contact_name)}_${dateSlug}.pdf`
  doc.save(filename)
}
