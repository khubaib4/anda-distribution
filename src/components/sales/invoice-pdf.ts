import { jsPDF } from 'jspdf'
import {
  formatPKR,
  formatQty,
  formatDate,
  paymentStatusLabel,
  effectiveItemPricePaisa,
  computeSaleSubtotalPaisa,
  computeSalePaymentBreakdown,
} from '@/lib/utils'
import type { Sale } from '@/types'

function pdfPKR(paisa: number): string {
  return formatPKR(paisa).replace('₨', 'Rs.').replace(/\u00A0/g, ' ')
}

export function generateInvoicePDF(sale: Sale): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin    = 20
  let y           = 22

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('Anda Distribution', margin, y)

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
    { align: 'right' }
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
  const colQty      = 88
  const colPrice    = 130
  const colTotal    = pageWidth - margin

  doc.setFillColor(245, 245, 244)
  doc.rect(margin, y - 5, pageWidth - 2 * margin, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Egg Category', colCategory, y)
  doc.text('Qty',           colQty,      y)
  doc.text('Price/tray',    colPrice,    y)
  doc.text('Total',         colTotal,    y, { align: 'right' })

  y += 10
  doc.setFont('helvetica', 'normal')

  const items = sale.items ?? []

  for (const item of items) {
    if (y > 250) {
      doc.addPage()
      y = 20
    }

    const effectivePrice = effectiveItemPricePaisa(item)
    const lineTotal = item.quantity_trays * effectivePrice
    const hasDiscount = (item.discounted_price_paisa ?? 0) > 0

    doc.text(item.egg_category?.name ?? '—', colCategory, y)
    doc.text(formatQty(item.quantity_trays), colQty, y)
    if (hasDiscount) {
      doc.setTextColor(120, 120, 120)
      doc.text(pdfPKR(item.price_per_tray_paisa), colPrice, y)
      doc.setTextColor(0, 0, 0)
      doc.text(pdfPKR(effectivePrice), colPrice, y + 4)
      y += 4
    } else {
      doc.text(pdfPKR(effectivePrice), colPrice, y)
    }
    doc.text(pdfPKR(lineTotal), colTotal, y, { align: 'right' })
    y += 8
  }

  y += 2
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 10

  const subtotal = sale.subtotal_paisa ?? computeSaleSubtotalPaisa(items)
  const discount = sale.discount_amount_paisa ?? 0
  const total = sale.total_paisa ?? subtotal - discount
  const { paid_paisa, remaining_paisa } = computeSalePaymentBreakdown({
    payment_status:    sale.payment_status,
    amount_paid_paisa: sale.amount_paid_paisa,
    total_paisa:       total,
  })

  const labelX = pageWidth - margin - 55

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Subtotal', labelX, y)
  doc.text(pdfPKR(subtotal), colTotal, y, { align: 'right' })
  y += 8

  if (discount > 0) {
    doc.setTextColor(22, 163, 74)
    doc.text('Discount', labelX, y)
    doc.text(`- ${pdfPKR(discount)}`, colTotal, y, { align: 'right' })
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
