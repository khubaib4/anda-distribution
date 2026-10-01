import {
  computeSaleSubtotalPaisa,
  computeSaleTotalPaisa,
  computeSalePaymentBreakdown,
  effectiveItemLineTotalPaisa,
  formatDate,
  formatQty,
  paymentStatusLabel,
} from '@/lib/utils'
import { formatPdfPKR } from '@/lib/pdf-money'
import type { Sale } from '@/types'
import styles from './sales-receipt.module.css'

export default function SalesReceiptContent({ sale, businessName }: {
  sale: Sale
  businessName: string
}) {
  const items = sale.items ?? []
  const subtotal = computeSaleSubtotalPaisa(items)
  const total = computeSaleTotalPaisa(sale)
  const discount = subtotal - total
  const payment = computeSalePaymentBreakdown({
    payment_status: sale.payment_status,
    amount_paid_paisa: sale.amount_paid_paisa,
    total_paisa: total,
  })

  return (
    <>
      <header className={styles.heading}>
        <h1>{businessName}</h1>
        <p>Sales invoice</p>
      </header>
      <div className={styles.section}>
        <p><strong>Invoice:</strong> {sale.invoice_number ?? '—'}</p>
        <p><strong>Date:</strong> {formatDate(sale.sale_date)}</p>
        <p><strong>Customer:</strong> {sale.customer?.contact_name ?? '—'}</p>
        {sale.customer?.business_name && <p>{sale.customer.business_name}</p>}
        {sale.customer?.phone && <p>{sale.customer.phone}</p>}
      </div>
      <div className={styles.section}>
        {items.map(item => (
          <div className={styles.item} key={item.id}>
            <strong>{item.egg_category?.name ?? '—'}</strong>
            <p>{formatQty(item.quantity_trays)}</p>
            <p>Rate: {formatPdfPKR(item.price_per_tray_paisa)} / tray</p>
            {item.discount_type === 'percentage' && (
              <p>Item discount: {item.discount_value}%</p>
            )}
            {item.discount_type === 'fixed' && (
              <p>Item discount: {formatPdfPKR(Math.round(item.discount_value * 100))} / peti</p>
            )}
            <div className={styles.amountRow}>
              <span>Line total</span>
              <strong>{formatPdfPKR(effectiveItemLineTotalPaisa(item))}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.totals}>
        <div className={styles.amountRow}>
          <span>Subtotal after item discounts</span><span>{formatPdfPKR(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className={styles.amountRow}>
            <span>Invoice discount</span><span>− {formatPdfPKR(discount)}</span>
          </div>
        )}
        <div className={styles.amountRow}>
          <strong>Total</strong><strong>{formatPdfPKR(total)}</strong>
        </div>
        <div className={styles.amountRow}>
          <span>Paid</span><span>{formatPdfPKR(payment.paid_paisa)}</span>
        </div>
        <div className={styles.amountRow}>
          <strong>Balance due</strong><strong>{formatPdfPKR(payment.remaining_paisa)}</strong>
        </div>
        <p>Payment status: {paymentStatusLabel(sale.payment_status)}</p>
        <p className={styles.thanks}>Thank you for your business</p>
      </div>
    </>
  )
}
