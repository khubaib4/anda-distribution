'use client'

import { Trash2 } from 'lucide-react'
import type { EggCategory } from '@/types'

export interface SaleItemDraft {
  id:                   string
  egg_category_id:      string
  quantity_peti:        number
  quantity_tray:        number
  price_per_tray_paisa: number
}

interface Props {
  item:       SaleItemDraft
  categories: EggCategory[]
  onChange:   (id: string, patch: Partial<SaleItemDraft>) => void
  onRemove:   (id: string) => void
  canRemove:  boolean
}

export default function SaleItemRow({
  item,
  categories,
  onChange,
  onRemove,
  canRemove,
}: Props) {
  const totalTrays  = item.quantity_peti * 12 + item.quantity_tray
  const totalPaisa  = totalTrays * item.price_per_tray_paisa
  const totalRupees = totalPaisa / 100

  return (
    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-3">

      {/* Category + remove */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1">
          <label className="label">Egg category</label>
          <select
            className="select"
            value={item.egg_category_id}
            onChange={e =>
              onChange(item.id, { egg_category_id: e.target.value })
            }
          >
            <option value="">Select category…</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="btn-ghost p-1.5 mt-5 text-danger hover:bg-red-50"
            aria-label="Remove item"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Quantity */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Peti</label>
          <input
            type="number"
            min="0"
            className="input"
            placeholder="0"
            value={item.quantity_peti || ''}
            onChange={e =>
              onChange(item.id, {
                quantity_peti: Math.max(0, parseInt(e.target.value) || 0),
              })
            }
          />
        </div>
        <div>
          <label className="label">Extra trays</label>
          <input
            type="number"
            min="0"
            max="11"
            className="input"
            placeholder="0"
            value={item.quantity_tray || ''}
            onChange={e =>
              onChange(item.id, {
                quantity_tray: Math.max(
                  0,
                  Math.min(11, parseInt(e.target.value) || 0)
                ),
              })
            }
          />
        </div>
      </div>

      {/* Price */}
      <div>
        <label className="label">Price per tray (₨)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          className="input"
          placeholder="0.00"
          value={item.price_per_tray_paisa
            ? item.price_per_tray_paisa / 100
            : ''}
          onChange={e =>
            onChange(item.id, {
              price_per_tray_paisa: Math.round(
                parseFloat(e.target.value || '0') * 100
              ),
            })
          }
        />
      </div>

      {/* Line total */}
      {totalTrays > 0 && item.price_per_tray_paisa > 0 && (
        <div className="flex items-center justify-between pt-1
                        border-t border-stone-200">
          <span className="text-xs text-stone-500">
            {totalTrays} tray{totalTrays !== 1 ? 's' : ''}
            {item.quantity_peti > 0 && ` (${item.quantity_peti} peti)`}
          </span>
          <span className="amount text-sm text-stone-900">
            ₨ {totalRupees.toLocaleString('en-IN', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      )}
    </div>
  )
}
