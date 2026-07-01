'use client'

import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { useEggCategories } from '@/hooks/use-egg-categories'
import {
  todayString,
  formatEggs,
  traysToEggs,
  formatPKRDecimal,
} from '@/lib/utils'

interface Props {
  onClose: () => void
  onSaved: () => void
}

const REASON_OPTIONS = [
  'Breakage',
  'Wastage',
  'Returned to supplier',
  'Expired / Spoiled',
  'Counting correction',
  'Other',
] as const

export default function AdjustmentModal({ onClose, onSaved }: Props) {
  const { categories } = useEggCategories()

  const [categoryId,   setCategoryId]   = useState('')
  const [movementType, setMovementType] = useState<
    'adjustment_in' | 'adjustment_out' | 'opening_stock'
  >('adjustment_in')
  const [quantityUnit, setQuantityUnit] = useState<'eggs' | 'trays'>('eggs')
  const [quantityInput, setQuantityInput] = useState('')
  const [reasonOption,  setReasonOption]  = useState('')
  const [customReason,  setCustomReason]  = useState('')
  const [pricePerEgg,   setPricePerEgg]   = useState('')
  const [date,          setDate]          = useState(todayString())
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  const parsedQty = parseFloat(quantityInput) || 0

  const conversionText = useMemo(() => {
    if (parsedQty <= 0) return null
    if (quantityUnit === 'eggs') {
      const eggs = Math.round(parsedQty)
      return formatEggs(eggs)
    }
    return `= ${traysToEggs(parsedQty)} eggs`
  }, [parsedQty, quantityUnit])

  const pricePerTrayText = useMemo(() => {
    const eggPrice = parseFloat(pricePerEgg)
    if (!eggPrice || eggPrice <= 0) return null
    const trayPrice = eggPrice * 30
    return `= ${formatPKRDecimal(Math.round(trayPrice * 100))} per tray (30 eggs)`
  }, [pricePerEgg])

  const finalReason =
    reasonOption === 'Other' ? customReason.trim() : reasonOption

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!categoryId) {
      setError('Please select an egg category')
      return
    }
    if (parsedQty <= 0) {
      setError('Quantity must be greater than 0')
      return
    }
    if (movementType === 'adjustment_out' && !finalReason) {
      setError('Please select a reason for removal')
      return
    }

    setSaving(true)
    setError(null)

    const payload: Record<string, unknown> = {
      egg_category_id: categoryId,
      movement_type:   movementType,
      quantity_unit:   quantityUnit,
      movement_date:   date,
    }

    if (quantityUnit === 'eggs') {
      payload.quantity_eggs = Math.round(parsedQty)
    } else {
      payload.quantity_trays = parsedQty
    }

    if (movementType === 'adjustment_out') {
      payload.reason = finalReason
    }

    if (
      (movementType === 'adjustment_in' || movementType === 'opening_stock') &&
      pricePerEgg
    ) {
      const eggPrice = parseFloat(pricePerEgg)
      if (eggPrice > 0) {
        payload.price_per_egg_paisa = Math.round(eggPrice * 100)
      }
    }

    const res = await window.fetch('/api/stock/movements', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Failed to save adjustment')
      setSaving(false)
      return
    }

    onSaved()
  }

  const typeLabels = {
    adjustment_in:  'Stock in (adjustment)',
    adjustment_out: 'Stock out (adjustment)',
    opening_stock:  'Opening stock',
  }

  const showReason =
    movementType === 'adjustment_out'
  const showPrice =
    movementType === 'adjustment_in' || movementType === 'opening_stock'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="text-base font-semibold text-stone-900">
            Stock adjustment
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5 -mr-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body space-y-4">

            {error && (
              <div className="text-sm text-danger bg-red-50 border
                              border-red-200 rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="label">Adjustment type</label>
              <select
                className="select"
                value={movementType}
                onChange={e => setMovementType(
                  e.target.value as typeof movementType,
                )}
              >
                {Object.entries(typeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="label">Egg category</label>
              <select
                className="select"
                value={categoryId}
                onChange={e => setCategoryId(e.target.value)}
              >
                <option value="">Select category…</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Quantity */}
            <div className="space-y-2">
              <label className="label">Quantity</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setQuantityUnit('eggs')}
                  className={[
                    'flex-1 text-xs font-medium py-1.5 rounded-md border',
                    quantityUnit === 'eggs'
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-stone-200 text-stone-600',
                  ].join(' ')}
                >
                  Eggs
                </button>
                <button
                  type="button"
                  onClick={() => setQuantityUnit('trays')}
                  className={[
                    'flex-1 text-xs font-medium py-1.5 rounded-md border',
                    quantityUnit === 'trays'
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-stone-200 text-stone-600',
                  ].join(' ')}
                >
                  Trays
                </button>
              </div>

              <div>
                <label className="label">
                  {quantityUnit === 'eggs'
                    ? 'Number of eggs'
                    : 'Number of trays'}
                </label>
                <input
                  type="number"
                  min="0"
                  step={quantityUnit === 'eggs' ? '1' : '0.1'}
                  className="input"
                  placeholder="0"
                  value={quantityInput}
                  onChange={e => setQuantityInput(e.target.value)}
                />
              </div>

              {conversionText && (
                <p className="text-xs text-stone-500">{conversionText}</p>
              )}
            </div>

            {/* Reason (adjustment_out only) */}
            {showReason && (
              <div className="space-y-2">
                <div className="form-group">
                  <label className="label">Reason for removal</label>
                  <select
                    className="select"
                    value={reasonOption}
                    onChange={e => setReasonOption(e.target.value)}
                  >
                    <option value="">Select reason…</option>
                    {REASON_OPTIONS.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                {reasonOption === 'Other' && (
                  <div className="form-group">
                    <label className="label">Custom reason</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="Describe reason…"
                      value={customReason}
                      onChange={e => setCustomReason(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Price (adjustment_in / opening_stock only) */}
            {showPrice && (
              <div className="space-y-2">
                <div className="form-group">
                  <label className="label">Price per egg (₨)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    placeholder="Optional"
                    value={pricePerEgg}
                    onChange={e => setPricePerEgg(e.target.value)}
                  />
                </div>
                {pricePerTrayText && (
                  <p className="text-xs text-stone-500">{pricePerTrayText}</p>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                value={date}
                max={todayString()}
                onChange={e => setDate(e.target.value)}
              />
            </div>

          </div>

          <div className="modal-footer">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
