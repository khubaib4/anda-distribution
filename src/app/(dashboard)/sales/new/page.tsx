'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useCustomers } from '@/hooks/use-customers'
import { useEggCategories } from '@/hooks/use-egg-categories'
import { useCurrentStock } from '@/hooks/use-stock'
import SaleItemRow, {
  type SaleItemDraft,
} from '@/components/sales/sale-item-row'
import { todayString, formatPKR, formatQty } from '@/lib/utils'

function newItem(): SaleItemDraft {
  return {
    id:                   crypto.randomUUID(),
    egg_category_id:      '',
    quantity_peti:        0,
    quantity_tray:        0,
    price_per_tray_paisa: 0,
  }
}

export default function NewSalePage() {
  const router = useRouter()
  const { customers }  = useCustomers()
  const { categories } = useEggCategories()
  const { stock }      = useCurrentStock()

  // Header fields
  const [customerId,    setCustomerId]    = useState('')
  const [saleDate,      setSaleDate]      = useState(todayString())
  const [paymentStatus, setPaymentStatus] = useState<
    'paid' | 'partial' | 'unpaid'
  >('unpaid')
  const [notes,         setNotes]         = useState('')

  // Line items
  const [items, setItems] = useState<SaleItemDraft[]>([newItem()])

  // UI state
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // Item handlers
  const handleItemChange = useCallback(
    (id: string, patch: Partial<SaleItemDraft>) => {
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

  // Stock lookup helper
  function getAvailableStock(categoryId: string): number {
    return stock.find(s => s.egg_category_id === categoryId)
      ?.quantity_trays ?? 0
  }

  // Submit
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Please select a customer')
      return
    }

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

      // Stock check
      const available = getAvailableStock(item.egg_category_id)
      if (trays > available) {
        const cat = categories.find(c => c.id === item.egg_category_id)
        setError(
          `Not enough stock for ${cat?.name ?? 'selected category'}. ` +
          `Available: ${formatQty(available)}, requested: ${formatQty(trays)}`
        )
        return
      }
    }

    setSaving(true)

    try {
      const payload = {
        customer_id:    customerId,
        sale_date:      saleDate,
        payment_status: paymentStatus,
        notes:          notes || null,
        items: items.map(item => ({
          egg_category_id:      item.egg_category_id,
          quantity_trays:       item.quantity_peti * 12 + item.quantity_tray,
          price_per_tray_paisa: item.price_per_tray_paisa,
        })),
      }

      const res = await fetch('/api/sales', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to save sale')
        setSaving(false)
        return
      }

      router.push('/sales')
    } catch {
      setError('Network error — please try again')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">

      {/* Back + title */}
      <div className="mb-6">
        <Link
          href="/sales"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Sales
        </Link>
        <h1 className="page-title">New sale</h1>
        <p className="page-subtitle">
          Invoice number will be auto-generated on save
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">

        {/* Customer & Date */}
        <div className="card p-4 space-y-4">
          <p className="section-title">Customer & date</p>

          <div className="form-group">
            <label className="label">
              Customer <span className="text-danger">*</span>
            </label>
            <select
              className="select"
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              required
            >
              <option value="">Select customer…</option>
              {customers.map(c => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.contact_name}
                  {c.business_name ? ` — ${c.business_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="label">Sale date</label>
            <input
              type="date"
              className="input"
              value={saleDate}
              onChange={e => setSaleDate(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Stock availability hint */}
        {stock.length > 0 && (
          <div className="card p-3">
            <p className="section-title mb-2">Available stock</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {stock.map(s => (
                <div key={s.egg_category_id}
                     className="text-center bg-stone-50 rounded p-2">
                  <p className="text-2xs text-stone-500 font-medium">
                    {s.egg_category}
                  </p>
                  <p className="qty text-sm font-semibold text-stone-900">
                    {formatQty(s.quantity_trays)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Line items */}
        <div className="card p-4 space-y-3">
          <p className="section-title">Egg items</p>

          {items.map(item => (
            <SaleItemRow
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

        {/* Payment */}
        <div className="card p-4 space-y-4">
          <p className="section-title">Payment</p>

          <div className="form-group">
            <label className="label">Payment status</label>
            <select
              className="select"
              value={paymentStatus}
              onChange={e =>
                setPaymentStatus(
                  e.target.value as 'paid' | 'partial' | 'unpaid'
                )
              }
            >
              <option value="unpaid">Unpaid — collect later</option>
              <option value="paid">Paid — cash on delivery</option>
            </select>
          </div>

          {paymentStatus === 'paid' && grandTotalPaisa > 0 && (
            <p className="text-sm text-success">
              ✓ Full amount {formatPKR(grandTotalPaisa)} collected
            </p>
          )}
        </div>

        {/* Notes */}
        <div className="card p-4">
          <p className="section-title">Notes</p>
          <textarea
            className="textarea mt-2"
            rows={2}
            placeholder="Any notes about this sale…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {/* Error + submit */}
        {error && (
          <div className="text-sm text-danger bg-red-50 border border-red-200
                          rounded px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-3 pb-4">
          <Link
            href="/sales"
            className="btn-secondary flex-1 justify-center"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? 'Saving…' : 'Save sale'}
          </button>
        </div>

      </form>
    </div>
  )
}
