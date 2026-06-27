'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { useEggCategories } from '@/hooks/use-egg-categories'
import { todayString } from '@/lib/utils'

interface Props {
  onClose:   () => void
  onSaved:   () => void
}

export default function AdjustmentModal({ onClose, onSaved }: Props) {
  const { categories } = useEggCategories()

  const [categoryId,    setCategoryId]    = useState('')
  const [movementType,  setMovementType]  = useState<
    'adjustment_in' | 'adjustment_out' | 'opening_stock'
  >('adjustment_in')
  const [quantityPeti,  setQuantityPeti]  = useState('')
  const [quantityTray,  setQuantityTray]  = useState('')
  const [notes,         setNotes]         = useState('')
  const [date,          setDate]          = useState(todayString())
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  const totalTrays =
    (parseInt(quantityPeti) || 0) * 12 + (parseInt(quantityTray) || 0)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!categoryId) { setError('Please select an egg category'); return }
    if (totalTrays <= 0) { setError('Quantity must be greater than 0'); return }

    setSaving(true)
    setError(null)

    const res = await window.fetch('/api/stock/movements', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        egg_category_id: categoryId,
        movement_type:   movementType,
        quantity_peti:   quantityPeti,
        quantity_tray:   quantityTray,
        notes,
        movement_date:   date,
      }),
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
          <div className="modal-body">

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
                  e.target.value as typeof movementType
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

            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="label">Peti</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  placeholder="0"
                  value={quantityPeti}
                  onChange={e => setQuantityPeti(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label">Extra trays</label>
                <input
                  type="number"
                  min="0"
                  max="11"
                  className="input"
                  placeholder="0"
                  value={quantityTray}
                  onChange={e => setQuantityTray(e.target.value)}
                />
              </div>
            </div>

            {totalTrays > 0 && (
              <p className="text-xs text-stone-500">
                Total: {totalTrays} trays
              </p>
            )}

            <div className="form-group">
              <label className="label">Date</label>
              <input
                type="date"
                className="input"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="label">Reason / notes</label>
              <textarea
                className="textarea"
                rows={2}
                placeholder="e.g. Breakage, opening stock correction…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
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
