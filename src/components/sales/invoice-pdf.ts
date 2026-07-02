import { jsPDF } from 'jspdf'
import {
  formatPKR,
  formatQty,
  formatDate,
  paymentStatusLabel,
  effectiveItemLineTotalPaisa,
  computeSaleSubtotalPaisa,
  computeSalePaymentBreakdown,
} from '@/lib/utils'
import type { Sale, SaleItem } from '@/types'

function pdfPKR(paisa: number): string {
  return formatPKR(paisa).replace('₨', 'Rs.').replace(/\u00A0/g, ' ')
}

function pdfPetiPrice(pricePerTrayPaisa: number): string {
  return pdfPKR(pricePerTrayPaisa * 12)
}

function preDiscountSubtotalPaisa(items: SaleItem[]): number {
  return items.reduce(
    (sum, item) => sum + item.quantity_trays * item.price_per_tray_paisa,
    0,
  )
}

function itemDiscountsPaisa(items: SaleItem[]): number {
  return items.reduce((sum, item) => {
    const discounted = item.discounted_price_paisa ?? 0
    if (discounted > 0 && discounted !== item.price_per_tray_paisa) {
      return sum +
        (item.price_per_tray_paisa - discounted) * item.quantity_trays
    }
    return sum
  }, 0)
}

function itemHasDiscount(item: SaleItem): boolean {
  const discounted = item.discounted_price_paisa ?? 0
  return discounted > 0 && discounted !== item.price_per_tray_paisa
}

function itemDiscountNote(item: SaleItem): string | null {
  if (!itemHasDiscount(item)) return null

  if (item.discount_type === 'percentage') {
    return `Discount: ${item.discount_value}%`
  }

  const perPetiRupees =
    ((item.price_per_tray_paisa - item.discounted_price_paisa) * 12) / 100
  return `Discount: Rs. ${perPetiRupees.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} per peti`
}

export function generateInvoicePDF(sale: Sale): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin    = 20
  let y           = 22

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text("Doctor's Egg", margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Karachi, Pakistan', margin, y + 8)

  const invoiceNum = sale.invoice_number ?? '—'
  doc.setFontSize(10)
  doc.text(`Invoice: ${invoiceNum}`, pageWidth - margin, y, { align: 'right' })
  doc.text(
    `Date: ${formatDate(sale.sale_date)}`,
    pageWidth - margin,
    y + 8,
    { align: 'right' },
  )

  y += 22
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
  const colPrice    = 138
  const colTotal    = pageWidth - margin

  doc.setFillColor(245, 245, 244)
  doc.rect(margin, y - 5, pageWidth - 2 * margin, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Category',   colCategory, y)
  doc.text('Qty',        colQty,      y)
  doc.text('Price/peti', colPrice,    y)
  doc.text('Total',      colTotal,    y, { align: 'right' })

  y += 10
  doc.setFont('helvetica', 'normal')

  const items = sale.items ?? []

  for (const item of items) {
    if (y > 245) {
      doc.addPage()
      y = 20
    }

    const lineTotal = effectiveItemLineTotalPaisa(item)
    const discountNote = itemDiscountNote(item)

    doc.text(item.egg_category?.name ?? '—', colCategory, y)
    doc.text(formatQty(item.quantity_trays), colQty, y)
    doc.text(pdfPetiPrice(item.price_per_tray_paisa), colPrice, y)
    doc.text(pdfPKR(lineTotal), colTotal, y, { align: 'right' })
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
  const overallDiscount     = sale.discount_amount_paisa ?? 0
  const totalDiscount       = itemDiscounts + overallDiscount
  const afterItemDiscounts  = computeSaleSubtotalPaisa(items)
  const total               = sale.total_paisa ?? afterItemDiscounts - overallDiscount
  const { paid_paisa, remaining_paisa } = computeSalePaymentBreakdown({
    payment_status:    sale.payment_status,
    amount_paid_paisa: sale.amount_paid_paisa,
    total_paisa:       total,
  })

  const hasAnyDiscount =
    totalDiscount > 0 ||
    overallDiscount > 0 ||
    items.some(itemHasDiscount)

  const labelX = pageWidth - margin - 55

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Subtotal', labelX, y)
  doc.text(pdfPKR(preDiscountSubtotal), colTotal, y, { align: 'right' })
  y += 8

  if (hasAnyDiscount && totalDiscount > 0) {
    doc.setTextColor(22, 163, 74)
    doc.text('Discount', labelX, y)
    doc.text(`- ${pdfPKR(totalDiscount)}`, colTotal, y, { align: 'right' })
    doc.setTextColor(0, 0, 0)
    y += 8
  }

  doc.setFont('helvetica', 'bold')
  doc.text('Total', labelX, y)
  doc.text(pdfPKR(total), colTotal, y, { align: 'right' })
  y += 8

  doc.setFont('helvetica', 'normal')

  if (sale.payment_status === 'paid' || sale.payment_status === 'partial') {
    doc.text('Amount Paid', labelX, y)
    doc.text(pdfPKR(paid_paisa), colTotal, y, { align: 'right' })
    y += 8
  }

  if (sale.payment_status === 'partial' || sale.payment_status === 'unpaid') {
    doc.setFont('helvetica', 'bold')
    doc.text('Balance Due', labelX, y)
    doc.text(pdfPKR(remaining_paisa), colTotal, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 8
  }

  doc.text('Payment status', labelX, y)
  doc.text(paymentStatusLabel(sale.payment_status), colTotal, y, { align: 'right' })
  y += 20

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(100, 100, 100)
  doc.text('Thank you for your business', pageWidth / 2, y, { align: 'center' })

  const safeName = (sale.invoice_number ?? sale.id).replace(/[^a-zA-Z0-9-_]/g, '_')
  doc.save(`invoice_${safeName}.pdf`)
}
