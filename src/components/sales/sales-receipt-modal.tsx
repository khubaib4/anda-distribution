'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Printer, X } from 'lucide-react'
import Image from 'next/image'
import { useTenant } from '@/lib/tenant-client'
import type { Sale } from '@/types'
import SalesReceiptContent from './sales-receipt-content'
import styles from './sales-receipt.module.css'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'

const PAPER_PREFERENCE = 'doctors-egg.receipt-paper-width'
const SIDE_MARGINS = [3, 4, 5, 6, 7, 8]
type PaperWidth = 58 | 80

function savedPaperWidth(): PaperWidth {
  try {
    return window.localStorage.getItem(PAPER_PREFERENCE) === '58' ? 58 : 80
  } catch {
    return 80
  }
}

function savedSideMargin(width: PaperWidth): number {
  try {
    const saved = Number(window.localStorage.getItem(`${PAPER_PREFERENCE}.margin-${width}`))
    if (SIDE_MARGINS.includes(saved)) return saved
  } catch { /* Use the default when storage is unavailable. */ }
  return width === 58 ? 5 : 3
}

export default function SalesReceiptModal({ sale, onClose }: {
  sale: Sale
  onClose: () => void
}) {
  const { tenantName, logoUrl } = useTenant()
  const tenantFetch = useTenantFetch()
  const [printSale, setPrintSale] = useState(sale)
  const [refreshing, setRefreshing] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const paper = useRef<HTMLElement>(null)
  const [{ width, sideMargin }, setPaperSettings] = useState(() => {
    const width = savedPaperWidth()
    return { width, sideMargin: savedSideMargin(width) }
  })
  const [pageHeight, setPageHeight] = useState(100)
  const [printError, setPrintError] = useState<string | null>(null)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    const preparePaper = () => {
      const height = Math.ceil((paper.current?.getBoundingClientRect().height ?? 378) * 25.4 / 96) + 2
      flushSync(() => setPageHeight(Math.min(1000, Math.max(80, height))))
    }
    window.addEventListener('beforeprint', preparePaper)
    return () => {
      window.removeEventListener('beforeprint', preparePaper)
      element?.close()
    }
  }, [])

  async function printReceipt() {
    if (sale.account_summary) {
      setRefreshing(true)
      try {
        const res = await tenantFetch(`/api/sales/${sale.id}`)
        if (!res.ok) throw new Error('Unable to refresh')
        const fresh = await res.json()
        flushSync(() => setPrintSale(fresh))
      } catch {
        setPrintError('Unable to refresh the customer balance. Please try again before printing.')
        return
      } finally { setRefreshing(false) }
    }
    // Measure at the selected physical width; long receipts can paginate.
    const height = Math.ceil((paper.current?.getBoundingClientRect().height ?? 378) * 25.4 / 96) + 2
    flushSync(() => {
      setPageHeight(Math.min(1000, Math.max(80, height)))
      setPrintError(null)
    })
    try {
      window.print()
    } catch {
      setPrintError('Printing is unavailable here. Try opening this page in your normal browser or use Download Invoice.')
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      data-sales-receipt
      className={styles.preview}
      aria-labelledby="receipt-preview-title"
      onCancel={event => { event.preventDefault(); onClose() }}
    >
      <style>{`@media print {
        @page { size: ${width}mm ${pageHeight}mm; margin: 0; }
        html, body { height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: white !important; }
        body > *:not([data-sales-receipt]) { display: none !important; }
      }`}</style>
      <div className={styles.toolbar}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="receipt-preview-title" className="text-base font-semibold">Receipt preview</h2>
          <button type="button" onClick={onClose} className="btn-ghost p-2" aria-label="Close receipt preview">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div className="text-sm">
            <label htmlFor="receipt-paper-width">Paper width</label>
            <select
              id="receipt-paper-width"
              value={width}
              className="input mt-1"
              onChange={event => {
                const nextWidth: PaperWidth = event.target.value === '58' ? 58 : 80
                setPaperSettings({ width: nextWidth, sideMargin: savedSideMargin(nextWidth) })
                try { window.localStorage.setItem(PAPER_PREFERENCE, String(nextWidth)) } catch { /* Printing still works without storage. */ }
              }}
            >
              <option value="58">58 mm</option>
              <option value="80">80 mm</option>
            </select>
          </div>
          <div className="text-sm">
            <label htmlFor="receipt-side-margins">Side margins</label>
            <select
              id="receipt-side-margins"
              value={sideMargin}
              className="input mt-1"
              onChange={event => {
                const nextMargin = Number(event.target.value)
                if (!SIDE_MARGINS.includes(nextMargin)) return
                setPaperSettings({ width, sideMargin: nextMargin })
                try { window.localStorage.setItem(`${PAPER_PREFERENCE}.margin-${width}`, String(nextMargin)) } catch { /* Printing still works without storage. */ }
              }}
            >
              {SIDE_MARGINS.map(margin => <option key={margin} value={margin}>{margin} mm each side</option>)}
            </select>
          </div>
          <button type="button" onClick={printReceipt} disabled={refreshing} className="btn-primary">
            <Printer className="w-4 h-4" /> Print receipt
          </button>
        </div>
        <p className="text-xs text-stone-600 mt-3">
          Printable area: {width - 2 * sideMargin} mm. Adjust side margins to match your printer’s printable width.
        </p>
        <p className="text-xs text-stone-600 mt-3">
          Select your printer and matching paper size in the print window. Use 100% scale and turn off headers and footers.
          On phones, the printer must be supported by your phone’s print system.
        </p>
        {printError && <p role="alert" className="text-sm text-red-700 mt-2">{printError}</p>}
      </div>
      <div className={styles.paperArea}>
        <article
          ref={paper}
          className={styles.paper}
          style={{ width: `${width}mm`, paddingLeft: `${sideMargin}mm`, paddingRight: `${sideMargin}mm` }}
          aria-label="Sales invoice receipt"
        >
          {logoUrl && (
            <Image src={logoUrl} alt="Business logo" width={80} height={80} loading="eager" unoptimized className={styles.logo} />
          )}
          <SalesReceiptContent sale={printSale} businessName={tenantName ?? "Doctor's Egg"} />
        </article>
      </div>
    </dialog>,
    document.body,
  )
}
