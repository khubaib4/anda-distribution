'use client'

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  computeDiscountedPricePaisa,
  effectiveItemLineTotalPaisa,
  petiPriceStringFromTrayPaisa,
} from '@/lib/utils'
import type { EggCategory } from '@/types'

export interface SaleItemDraft {
  id:                   string
  egg_category_id:      string
  quantity_peti:        number
  quantity_tray:        number
  price_per_tray_paisa: number
  discount_type:        'percentage' | 'fixed' | null
  discount_value:       number
  discounted_price_paisa: number
}

interface Props {
  item:       SaleItemDraft
  categories: EggCategory[]
  onChange:   (id: string, patch: Partial<SaleItemDraft>) => void
  onRemove:   (id: string) => void
  canRemove:  boolean
}

function formatRupees(paisa: number): string {
  return (Math.round(paisa) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export default function SaleItemRow({
  item,
  categories,
  onChange,
  onRemove,
  canRemove,
}: Props) {
  const [discountOn, setDiscountOn] = useState(
    item.discount_type !== null && item.discount_value > 0,
  )
  const [pricePerPetiInput, setPricePerPetiInput] = useState(() =>
    petiPriceStringFromTrayPaisa(item.price_per_tray_paisa),
  )

  useEffect(() => {
    setPricePerPetiInput(petiPriceStringFromTrayPaisa(item.price_per_tray_paisa))
  }, [item.id])

  const totalTrays = item.quantity_peti * 12 + item.quantity_tray
  const originalLineTotal = totalTrays * item.price_per_tray_paisa
  const discountedLineTotal = effectiveItemLineTotalPaisa(item)
  const hasDiscount = (item.discounted_price_paisa ?? 0) > 0

  function applyDiscount(
    type: 'percentage' | 'fixed' | null,
    value: number,
    overrides?: Partial<
      Pick<SaleItemDraft, 'quantity_peti' | 'quantity_tray' | 'price_per_tray_paisa'>
    >,
  ) {
    const peti = overrides?.quantity_peti ?? item.quantity_peti
    const tray = overrides?.quantity_tray ?? item.quantity_tray
    const price = overrides?.price_per_tray_paisa ?? item.price_per_tray_paisa
    const trays = peti * 12 + tray
    const discounted = type
      ? computeDiscountedPricePaisa(trays, price, type, value)
      : 0

    onChange(item.id, {
      ...(overrides ?? {}),
      discount_type:          type,
      discount_value:         value,
      discounted_price_paisa: discounted,
    })
  }

  function toggleDiscount(on: boolean) {
    setDiscountOn(on)
    if (!on) {
      applyDiscount(null, 0)
    } else {
      applyDiscount('percentage', item.discount_value || 0)
    }
  }

  function savingMessage(): string | null {
    if (!hasDiscount) return null
    if (item.discount_type === 'fixed') {
      const saving = parseFloat(String(item.discount_value))
      if (saving <= 0) return null
      return `Saving ₨${saving.toLocaleString('en-IN')} total`
    }
    if (item.discount_type === 'percentage') {
      const savingAmount =
        (originalLineTotal * item.discount_value / 100) / 100
      if (savingAmount <= 0) return null
      return `Saving ${item.discount_value}% (₨${savingAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} total)`
    }
    return null
  }

  return (
    <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-3">

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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Peti</label>
          <input
            type="number"
            min="0"
            className="input"
            placeholder="0"
            value={item.quantity_peti || ''}
            onChange={e => {
              const quantity_peti = Math.max(0, parseInt(e.target.value) || 0)
              if (discountOn && item.discount_type) {
                applyDiscount(item.discount_type, item.discount_value, {
                  quantity_peti,
                })
              } else {
                onChange(item.id, { quantity_peti })
              }
            }}
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
            onChange={e => {
              const quantity_tray = Math.max(
                0,
                Math.min(11, parseInt(e.target.value) || 0),
              )
              if (discountOn && item.discount_type) {
                applyDiscount(item.discount_type, item.discount_value, {
                  quantity_tray,
                })
              } else {
                onChange(item.id, { quantity_tray })
              }
            }}
          />
        </div>
      </div>

      <div>
        <label className="label">Price per peti (₨)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          className="input"
          placeholder="0.00"
          value={pricePerPetiInput}
          onChange={e => {
            const input = e.target.value
            setPricePerPetiInput(input)
            const price_per_tray_paisa = Math.round(
              (parseFloat(input || '0') * 100) / 12,
            )
            if (discountOn && item.discount_type) {
              applyDiscount(item.discount_type, item.discount_value, {
                price_per_tray_paisa,
              })
            } else {
              onChange(item.id, { price_per_tray_paisa })
            }
          }}
        />
        {item.price_per_tray_paisa > 0 && (
          <p className="text-xs text-stone-500 mt-1">
            = ₨{(item.price_per_tray_paisa / 100).toFixed(2)} per tray
          </p>
        )}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => toggleDiscount(!discountOn)}
          className={[
            'text-xs font-medium px-2.5 py-1 rounded-md transition-colors',
            discountOn
              ? 'bg-brand-100 text-brand-700'
              : 'bg-stone-200 text-stone-600 hover:bg-stone-300',
          ].join(' ')}
        >
          {discountOn ? 'Discount on' : 'Discount'}
        </button>

        {discountOn && (
          <div className="space-y-2 pl-1">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  applyDiscount('percentage', item.discount_value || 0)
                }
                className={[
                  'flex-1 text-xs font-medium py-1.5 rounded-md border',
                  item.discount_type === 'percentage'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-stone-200 text-stone-600',
                ].join(' ')}
              >
                %
              </button>
              <button
                type="button"
                onClick={() =>
                  applyDiscount('fixed', item.discount_value || 0)
                }
                className={[
                  'flex-1 text-xs font-medium py-1.5 rounded-md border',
                  item.discount_type === 'fixed'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-stone-200 text-stone-600',
                ].join(' ')}
              >
                Fixed ₨
              </button>
            </div>
            <div>
              <label className="label">Discount value</label>
              <input
                type="number"
                min="0"
                step={item.discount_type === 'fixed' ? '0.01' : '1'}
                className="input"
                placeholder="0"
                value={item.discount_value || ''}
                onChange={e => {
                  const value = item.discount_type === 'fixed'
                    ? parseFloat(e.target.value || '0')
                    : parseInt(e.target.value || '0', 10)
                  applyDiscount(item.discount_type ?? 'percentage', value)
                }}
              />
            </div>
            {savingMessage() && (
              <p className="text-xs text-success">{savingMessage()}</p>
            )}
          </div>
        )}
      </div>

      {totalTrays > 0 && item.price_per_tray_paisa > 0 && (
        <div className="flex items-center justify-between pt-1
                        border-t border-stone-200">
          <span className="text-xs text-stone-500">
            {totalTrays} tray{totalTrays !== 1 ? 's' : ''}
            {item.quantity_peti > 0 && ` (${item.quantity_peti} peti)`}
          </span>
          <div className="text-right">
            {hasDiscount && (
              <p className="text-xs text-stone-400 line-through">
                ₨ {formatRupees(originalLineTotal)}
              </p>
            )}
            <span className="amount text-sm text-stone-900">
              ₨ {formatRupees(discountedLineTotal)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
