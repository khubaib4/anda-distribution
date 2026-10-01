import { jsPDF } from 'jspdf'
import { formatBalanceAsOf } from '@/lib/customer-account-money'
import {
  formatQty,
  formatDate,
  paymentStatusLabel,
  effectiveItemLineTotalPaisa,
  computeSaleSubtotalPaisa,
  computeSaleTotalPaisa,
  computeSalePaymentBreakdown,
} from '@/lib/utils'
import { drawPdfBrandedHeader, drawPdfHeaderRight } from '@/lib/pdf-logo'
import { formatPdfPKR } from '@/lib/pdf-money'
import type { Sale, SaleItem } from '@/types'

function pdfPetiPrice(pricePerTrayPaisa: number): string {
  return formatPdfPKR(pricePerTrayPaisa * 12)
}

function preDiscountSubtotalPaisa(items: SaleItem[]): number {
  return items.reduce(
    (sum, item) => sum + item.quantity_trays * item.price_per_tray_paisa,
    0,
  )
}

function itemDiscountsPaisa(items: SaleItem[]): number {
  return items.reduce(
    (sum, item) => sum + (
      item.quantity_trays * item.price_per_tray_paisa
      - (item.line_total_paisa ?? effectiveItemLineTotalPaisa(item))
    ),
    0,
  )
}

function itemHasDiscount(item: SaleItem): boolean {
  return item.discount_type === 'percentage' || item.discount_type === 'fixed'
}

function itemDiscountNote(item: SaleItem): string | null {
  if (!itemHasDiscount(item)) return null

  if (item.discount_type === 'percentage') {
    return `Discount: ${item.discount_value}%`
  }

  const perPetiRupees = item.discount_value ?? 0
  return `Discount: ${formatPdfPKR(Math.round(perPetiRupees * 100))} per peti`
}

export async function generateInvoicePDF(
  sale: Sale,
  logoUrl?: string | null,
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin    = 20
  let y           = 22

  const invoiceNum = sale.invoice_number ?? '—'

  const headerLayout = await drawPdfBrandedHeader(doc, {
    margin,
    pageWidth,
    y,
    logoUrl,
    title:    "Doctor's Egg",
    subtitle: 'Karachi, Pakistan',
  })

  drawPdfHeaderRight(doc, pageWidth, margin, headerLayout.rightY, [
    `Invoice: ${invoiceNum}`,
    `Date: ${formatDate(sale.sale_date)}`,
  ])

  y = headerLayout.dividerY
  doc.setLineWidth(0.4)
  doc.line(margin, y, pageWidth - margin, y)
  y += 12

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text('BILL TO', margin, y)
  y += 6

  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)

  if (sale.customer?.contact_name) {
    doc.text(sale.customer.contact_name, margin, y)
    y += 5
  }
  if (sale.customer?.business_name) {
    doc.text(sale.customer.business_name, margin, y)
    y += 5
  }
  if (sale.customer?.phone) {
    doc.text(sale.customer.phone, margin, y)
    y += 5
  }

  y += 8

  const colCategory = margin
  const colQty      = 95
  const colPrice    = 143
  const colTotal    = pageWidth - margin

  doc.setFillColor(245, 245, 244)
  doc.rect(margin, y - 5, pageWidth - 2 * margin, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Category',   colCategory, y)
  doc.text('Qty',        colQty,      y)
  doc.text('Price/peti', colPrice,    y, { align: 'right' })
  doc.text('Total',      colTotal,    y, { align: 'right' })

  y += 10
  doc.setFont('helvetica', 'normal')

  const items = sale.items ?? []

  for (const item of items) {
    if (y > 245) {
      doc.addPage()
      y = 20
    }

    const lineTotal = sale.account_summary ? item.line_total_paisa ?? effectiveItemLineTotalPaisa(item) : effectiveItemLineTotalPaisa(item)
    const discountNote = itemDiscountNote(item)

    doc.text(item.egg_category?.name ?? '—', colCategory, y)
    doc.text(formatQty(item.quantity_trays), colQty, y)
    doc.text(pdfPetiPrice(item.price_per_tray_paisa), colPrice, y, { align: 'right' })
    doc.text(formatPdfPKR(lineTotal), colTotal, y, { align: 'right' })
    y += 6

    if (discountNote) {
      doc.setFontSize(8)
      doc.setTextColor(120, 120, 120)
      doc.text(discountNote, colCategory, y)
      doc.setTextColor(0, 0, 0)
      doc.setFontSize(9)
      y += 5
    }

    y += 2
  }

  y += 2
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 10

  const preDiscountSubtotal = preDiscountSubtotalPaisa(items)
  const itemDiscounts       = itemDiscountsPaisa(items)
  const afterItemDiscounts  = sale.account_summary ? sale.subtotal_paisa ?? computeSaleSubtotalPaisa(items) : computeSaleSubtotalPaisa(items)
  const total               = sale.account_summary ? sale.total_paisa ?? computeSaleTotalPaisa(sale) : computeSaleTotalPaisa(sale)
  const overallDiscount     = afterItemDiscounts - total
  const totalDiscount       = itemDiscounts + overallDiscount
  const { paid_paisa, remaining_paisa } = computeSalePaymentBreakdown({
    payment_status:    sale.payment_status,
    amount_paid_paisa: sale.amount_paid_paisa,
    total_paisa:       total,
  })

  const hasAnyDiscount =
    totalDiscount > 0 ||
    overallDiscount > 0 ||
    items.some(itemHasDiscount)

  const labelX = pageWidth - margin - 80

  if (y > 210) { doc.addPage(); y = 25 }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Subtotal', labelX, y)
  doc.text(formatPdfPKR(preDiscountSubtotal), colTotal, y, { align: 'right' })
  y += 8

  if (hasAnyDiscount && totalDiscount > 0) {
    doc.setTextColor(22, 163, 74)
    doc.text('Discount', labelX, y)
    doc.text(`- ${formatPdfPKR(totalDiscount)}`, colTotal, y, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    y += 8
  }

  doc.setFont('helvetica', 'bold')
  doc.text('Total', labelX, y)
  doc.text(formatPdfPKR(total), colTotal, y, { align: 'right' })
  y += 8

  doc.setFont('helvetica', 'normal')

  if (sale.payment_status === 'paid' || sale.payment_status === 'partial') {
    doc.text(sale.account_summary ? 'Paid toward this invoice' : 'Amount Paid', labelX, y)
    doc.text(formatPdfPKR(paid_paisa), colTotal, y, { align: 'right' })
    y += 8
  }

  if (sale.payment_status === 'partial' || sale.payment_status === 'unpaid') {
    doc.setFont('helvetica', 'bold')
    doc.text(sale.account_summary ? 'Balance due on this invoice' : 'Balance Due', labelX, y)
    doc.text(formatPdfPKR(remaining_paisa), colTotal, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 8
  }

  doc.text('Payment status', labelX, y)
  doc.text(paymentStatusLabel(sale.payment_status), colTotal, y, { align: 'right' })
  y += 20

  if (sale.account_summary?.accounts_enabled) {
    if (y > 200) { doc.addPage(); y = 25 }
    const account = sale.account_summary
    doc.setFont('helvetica', 'bold')
    doc.text('Latest customer balance', margin, y)
    y += 8
    doc.setFont('helvetica', 'normal')
    const rows: [string, number][] = [
      ['Advance used for this invoice', sale.advance_used_paisa ?? 0],
      ['Other unpaid balances', Math.max(0, account.due_paisa - remaining_paisa)],
      ['Total balance due', account.due_paisa],
      ['Available advance', account.advance_paisa],
    ]
    for (const [label, amount] of rows) {
      doc.text(label, margin, y)
      doc.text(formatPdfPKR(amount), colTotal, y, { align: 'right' })
      y += 7
    }
    doc.setFontSize(8)
    doc.text(`Balance as of ${formatBalanceAsOf(account.balance_as_of)}`, margin, y)
    y += 15
  }

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(100, 100, 100)
  doc.text('Thank you for your business', pageWidth / 2, y, { align: 'center' })

  const safeName = (sale.invoice_number ?? sale.id).replace(/[^a-zA-Z0-9-_]/g, '_')
  doc.save(`invoice_${safeName}.pdf`)
}
