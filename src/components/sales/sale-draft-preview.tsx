'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { formatAccountPKR as formatPKR } from '@/lib/customer-account-money'
import { effectiveItemLineTotalPaisa, formatDate, formatQty } from '@/lib/utils'
import type { EggCategory } from '@/types'
import type { SaleItemDraft } from './sale-item-row'
import styles from './sale-counter.module.css'

export default function SaleDraftPreview({ open, onClose, customerName, saleDate, items, categories,
  subtotal, discount, total, notes, closingDue, closingAdvance }: {
  open: boolean; onClose: () => void; customerName: string; saleDate: string
  items: SaleItemDraft[]; categories: EggCategory[]; subtotal: number; discount: number; total: number
  notes: string; closingDue?: number; closingAdvance?: number
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (open && element && !element.open) element.showModal()
    if (!open && element?.open) element.close()
  }, [open])

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="sale-draft-title" onClose={onClose}>
    <div className={styles.dialogHeader}>
      <div><h2 id="sale-draft-title">Invoice preview</h2><p className={styles.hint}>Draft · invoice number assigned on save</p></div>
      <button type="button" className="btn-ghost p-2" aria-label="Close invoice preview" onClick={onClose}><X className="w-5 h-5" /></button>
    </div>
    <div className={styles.draft}>
      <div className={styles.draftCustomer}><strong>{customerName || 'Select a customer'}</strong><span className="text-sm text-stone-500">{saleDate ? formatDate(saleDate) : 'Choose a sale date'}</span></div>
      <div className={styles.draftItems}>
        {items.map(item => <div className={styles.draftItem} key={item.id}>
          <div>{categories.find(category => category.id === item.egg_category_id)?.name ?? 'Select egg category'}<br />
            <span>{formatQty(item.quantity_peti * 12 + item.quantity_tray)}</span>
          </div><strong>{formatPKR(effectiveItemLineTotalPaisa(item))}</strong>
        </div>)}
      </div>
      <dl className={styles.summaryRows}>
        <div className={styles.summaryRow}><dt>Egg items</dt><dd>{formatPKR(subtotal)}</dd></div>
        {discount > 0 && <div className={styles.summaryRow}><dt>Overall discount</dt><dd>− {formatPKR(discount)}</dd></div>}
        <div className={`${styles.summaryRow} ${styles.grandTotal}`}><dt>This sale</dt><dd>{formatPKR(total)}</dd></div>
      </dl>
      {closingDue !== undefined && <dl className={styles.closing}>
        <div className={styles.summaryRow}><dt>Customer due after sale</dt><dd className="text-danger">{formatPKR(closingDue)}</dd></div>
        <div className={styles.summaryRow}><dt>Advance remaining</dt><dd className="text-success">{formatPKR(closingAdvance ?? 0)}</dd></div>
      </dl>}
      {notes && <p className={styles.draftNote}>{notes}</p>}
      <p className={styles.hint}>Preview only. The sale and payment are recorded when you choose Save sale.</p>
    </div>
  </dialog>
}
