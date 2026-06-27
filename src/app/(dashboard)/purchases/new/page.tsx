'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useSuppliers } from '@/hooks/use-suppliers'
import { useEggCategories } from '@/hooks/use-egg-categories'
import PurchaseItemRow, {
  type PurchaseItemDraft,
} from '@/components/purchases/purchase-item-row'
import { todayString, formatPKR } from '@/lib/utils'

function newItem(): PurchaseItemDraft {
  return {
    id:                   crypto.randomUUID(),
    egg_category_id:      '',
    quantity_peti:        0,
    quantity_tray:        0,
    price_per_tray_paisa: 0,
  }
}

export default function NewPurchasePage() {
  const router = useRouter()
  const { suppliers } = useSuppliers()
  const { categories } = useEggCategories()

  // Header fields
  const [supplierId,     setSupplierId]     = useState('')
  const [supplierName,   setSupplierName]   = useState('')
  const [purchaseDate,   setPurchaseDate]   = useState(todayString())
  const [paymentStatus,  setPaymentStatus]  = useState<'paid' | 'partial' | 'unpaid'>('unpaid')
  const [amountPaid,     setAmountPaid]     = useState('')
  const [notes,          setNotes]          = useState('')

  // Line items
  const [items, setItems] = useState<PurchaseItemDraft[]>([newItem()])

  // UI state
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // Item handlers
  const handleItemChange = useCallback(
    (id: string, patch: Partial<PurchaseItemDraft>) => {
      setItems(prev =>
        prev.map(item => (item.id === id ? { ...item, ...patch } : item))
      )
    },
    []
  )

  const handleItemRemove = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id))
  }, [])

  const handleAddItem = () => setItems(prev => [...prev, newItem()])

  // Totals
  const grandTotalPaisa = items.reduce((sum, item) => {
    const trays = item.quantity_peti * 12 + item.quantity_tray
    return sum + trays * item.price_per_tray_paisa
  }, 0)

  const totalTrays = items.reduce(
    (sum, item) => sum + item.quantity_peti * 12 + item.quantity_tray,
    0
  )

  // Submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validate items
    for (const item of items) {
      if (!item.egg_category_id) {
        setError('Please select a category for each item')
        return
      }
      const trays = item.quantity_peti * 12 + item.quantity_tray
      if (trays === 0) {
        setError('Quantity must be greater than 0 for each item')
        return
      }
      if (item.price_per_tray_paisa === 0) {
        setError('Price must be greater than 0 for each item')
        return
      }
    }

    setSaving(true)

    try {
      const selectedSupplier = suppliers.find(s => s.id === supplierId)

      const payload = {
        supplier_id:       supplierId || null,
        supplier_name:     selectedSupplier?.name || supplierName || null,
        purchase_date:     purchaseDate,
        notes:             notes || null,
        payment_status:    paymentStatus,
        amount_paid_paisa: paymentStatus === 'paid'
          ? grandTotalPaisa
          : Math.round(parseFloat(amountPaid || '0') * 100),
        items: items.map(item => ({
          egg_category_id:      item.egg_category_id,
          quantity_trays:       item.quantity_peti * 12 + item.quantity_tray,
          price_per_tray_paisa: item.price_per_tray_paisa,
        })),
      }

      const res = await fetch('/api/purchases', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to save purchase')
        setSaving(false)
        return
      }

      router.push('/purchases')
    } catch {
      setError('Network error — please try again')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">

      {/* Back link + title */}
      <div className="mb-6">
        <Link
          href="/purchases"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Purchases
        </Link>
        <h1 className="page-title">New purchase</h1>
        <p className="page-subtitle">
          Invoice number will be auto-generated on save
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">

        {/* ── Supplier & Date ── */}
        <div className="card p-4 space-y-4">
          <p className="section-title">Supplier & date</p>

          <div className="form-group">
            <label className="label">Supplier</label>
            <select
              className="select"
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
            >
              <option value="">Select supplier…</option>
              {suppliers
                .filter(s => s.is_active)
                .map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
          </div>

          {!supplierId && (
            <div className="form-group">
              <label className="label">Or type supplier name</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Ahmed Poultry Farm"
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label className="label">Purchase date</label>
            <input
              type="date"
              className="input"
              value={purchaseDate}
              onChange={e => setPurchaseDate(e.target.value)}
              required
            />
          </div>
        </div>

        {/* ── Line items ── */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Egg items</p>

          {items.map(item => (
            <PurchaseItemRow
              key={item.id}
              item={item}
              categories={categories}
              onChange={handleItemChange}
              onRemove={handleItemRemove}
              canRemove={items.length > 1}
            />
          ))}

          <button
            type="button"
            onClick={handleAddItem}
            className="btn-secondary w-full mt-1"
          >
            <Plus className="w-4 h-4" />
            Add another category
          </button>

          {/* Grand total */}
          {grandTotalPaisa > 0 && (
            <div className="flex items-center justify-between pt-3
                            border-t border-stone-200 mt-2">
              <div>
                <p className="text-xs text-stone-500">Grand total</p>
                <p className="text-2xs text-stone-400">
                  {totalTrays} trays total
                </p>
              </div>
              <p className="amount text-lg text-stone-900">
                {formatPKR(grandTotalPaisa)}
              </p>
            </div>
          )}
        </div>

        {/* ── Payment ── */}
        <div className="card p-4 space-y-4">
          <p className="section-title">Payment</p>

          <div className="form-group">
            <label className="label">Payment status</label>
            <select
              className="select"
              value={paymentStatus}
              onChange={e =>
                setPaymentStatus(e.target.value as 'paid' | 'partial' | 'unpaid')
              }
            >
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          {paymentStatus === 'partial' && (
            <div className="form-group">
              <label className="label">Amount paid (₨)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                placeholder="0.00"
                value={amountPaid}
                onChange={e => setAmountPaid(e.target.value)}
              />
            </div>
          )}

          {paymentStatus === 'paid' && grandTotalPaisa > 0 && (
            <p className="text-sm text-success">
              Full amount {formatPKR(grandTotalPaisa)} will be marked as paid
            </p>
          )}
        </div>

        {/* ── Notes ── */}
        <div className="card p-4">
          <p className="section-title">Notes</p>
          <textarea
            className="textarea mt-2"
            rows={2}
            placeholder="Any notes about this purchase…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {/* ── Error + Submit ── */}
        {error && (
          <div className="text-sm text-danger bg-red-50 border border-red-200
                          rounded px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-4">
          <Link href="/purchases" className="btn-secondary flex-1 justify-center">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? 'Saving…' : 'Save purchase'}
          </button>
        </div>

      </form>
    </div>
  )
}
