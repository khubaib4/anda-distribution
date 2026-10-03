'use client'

import { useId, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import styles from './sale-counter.module.css'
import {
  computeDiscountedPricePaisa,
  computeLineDiscountSavingPaisa,
  effectiveItemLineTotalPaisa,
  formatPKR,
} from '@/lib/utils'
import { itemPetiPriceInput, petiPriceInputPatch, itemBaseLineTotalPaisa } from '@/lib/peti-pricing'
import type { EggCategory } from '@/types'

export interface SaleItemDraft {
  id:                   string
  egg_category_id:      string
  quantity_peti:        number
  quantity_tray:        number
  price_per_tray_paisa: number
  price_per_peti_paisa?: number | null
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
  layout?: 'stacked' | 'counter'
}

function formatRupees(paisa: number): string {
  return formatPKR(paisa).replace('₨\u00a0', '')
}

export default function SaleItemRow({
  item,
  categories,
  onChange,
  onRemove,
  canRemove,
  layout = 'stacked',
}: Props) {
  const fieldId = useId()
  const discountOn = item.discount_type === 'percentage' || item.discount_type === 'fixed'
  const [pricePerPetiInput, setPricePerPetiInput] = useState(() =>
    itemPetiPriceInput(item),
  )

  const totalTrays = item.quantity_peti * 12 + item.quantity_tray
  const originalLineTotal = itemBaseLineTotalPaisa(item)
  const discountedLineTotal = effectiveItemLineTotalPaisa(item)
  const lineSavingPaisa = computeLineDiscountSavingPaisa(
    totalTrays,
    item.price_per_tray_paisa,
    item.discount_type,
    item.discount_value,
    item.price_per_peti_paisa,
  )

  function applyDiscount(
    type: 'percentage' | 'fixed' | null,
    value: number,
    overrides?: Partial<
      Pick<SaleItemDraft, 'quantity_peti' | 'quantity_tray' | 'price_per_tray_paisa' | 'price_per_peti_paisa'>
    >,
  ) {
    const peti = overrides?.quantity_peti ?? item.quantity_peti
    const tray = overrides?.quantity_tray ?? item.quantity_tray
    const price = overrides?.price_per_tray_paisa ?? item.price_per_tray_paisa
    const trays = peti * 12 + tray
    const discounted = type
      ? computeDiscountedPricePaisa(trays, price, type, value, overrides?.price_per_peti_paisa ?? item.price_per_peti_paisa)
      : 0

    onChange(item.id, {
      ...(overrides ?? {}),
      discount_type:          type,
      discount_value:         value,
      discounted_price_paisa: discounted,
    })
  }

  function toggleDiscount(on: boolean) {
    if (!on) {
      applyDiscount(null, 0)
    } else {
      applyDiscount('percentage', item.discount_value || 0)
    }
  }

  function savingMessage(): string | null {
    if (lineSavingPaisa <= 0) return null
    if (item.discount_type === 'fixed') {
      const perPeti = parseFloat(String(item.discount_value))
      if (perPeti <= 0) return null
      return `Saving ₨${perPeti.toLocaleString('en-IN', { maximumFractionDigits: 20 })} per peti (₨${formatRupees(lineSavingPaisa)} total)`
    }
    if (item.discount_type === 'percentage') {
      return `Saving ${item.discount_value}% (₨${formatRupees(lineSavingPaisa)} total)`
    }
    return null
  }

  if (layout === 'counter') {
    return (
      <div className={styles.counterItem}>
        <div className={styles.category}>
          <label className="label" htmlFor={`${fieldId}-category`}>Egg category</label>
          <select id={`${fieldId}-category`} className="select" value={item.egg_category_id}
            onChange={e => onChange(item.id, { egg_category_id: e.target.value })}>
            <option value="">Select category…</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>
        <div className={styles.quantities}>
          <div>
            <label className="label" htmlFor={`${fieldId}-peti`}>Peti</label>
            <input id={`${fieldId}-peti`} type="number" min="0" step="1" className="input" placeholder="0"
              value={item.quantity_peti || ''} onChange={e => {
                const quantity_peti = Math.max(0, parseInt(e.target.value) || 0)
                if (discountOn && item.discount_type) applyDiscount(item.discount_type, item.discount_value, { quantity_peti })
                else onChange(item.id, { quantity_peti })
              }} />
          </div>
          <div>
            <label className="label" htmlFor={`${fieldId}-tray`}>Extra trays</label>
            <input id={`${fieldId}-tray`} type="number" min="0" max="11" step="1" className="input" placeholder="0"
              value={item.quantity_tray || ''} onChange={e => {
                const quantity_tray = Math.max(0, Math.min(11, parseInt(e.target.value) || 0))
                if (discountOn && item.discount_type) applyDiscount(item.discount_type, item.discount_value, { quantity_tray })
                else onChange(item.id, { quantity_tray })
              }} />
          </div>
        </div>
        <div className={styles.rate}>
          <label className="label" htmlFor={`${fieldId}-rate`}>Price / peti (Rs)</label>
          <input id={`${fieldId}-rate`} type="number" min="0" step="0.01" className="input" placeholder="0.00"
            value={pricePerPetiInput} onChange={e => {
              setPricePerPetiInput(e.target.value)
              const prices = petiPriceInputPatch(e.target.value)
              if (discountOn && item.discount_type) applyDiscount(item.discount_type, item.discount_value, prices)
              else onChange(item.id, prices)
            }} />
        </div>
        <div className={styles.itemFooter}>
          <p>{totalTrays} tray{totalTrays !== 1 ? 's' : ''}{item.quantity_peti > 0 && ` · ${item.quantity_peti} peti`}</p>
          <div className={styles.itemTools}>
            <button type="button" className="btn-ghost text-xs px-2" aria-expanded={discountOn}
              onClick={() => toggleDiscount(!discountOn)}>
              {discountOn ? 'Remove discount' : 'Discount'}{!discountOn && <Plus className="w-3 h-3" />}
            </button>
            {canRemove && <button type="button" onClick={() => onRemove(item.id)} className="btn-ghost px-2 text-danger" aria-label="Remove item">
              <Trash2 className="w-4 h-4" />
            </button>}
          </div>
          <strong>{formatPKR(discountedLineTotal)}</strong>
        </div>
        {discountOn && <div className={styles.itemDiscount}>
          <div className={styles.discountFields}>
            <div>
              <label className="label" htmlFor={`${fieldId}-discount-type`}>Discount type</label>
              <select id={`${fieldId}-discount-type`} className="select" value={item.discount_type ?? 'percentage'}
                onChange={e => applyDiscount(e.target.value as 'percentage' | 'fixed', item.discount_value || 0)}>
                <option value="percentage">Percentage</option><option value="fixed">Rupees per peti</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor={`${fieldId}-discount-value`}>{item.discount_type === 'fixed' ? 'Discount / peti (Rs)' : 'Discount (%)'}</label>
              <input id={`${fieldId}-discount-value`} type="number" min="0" step={item.discount_type === 'fixed' ? '0.01' : '1'}
                className="input" placeholder="0" value={item.discount_value || ''} onChange={e => {
                  const value = item.discount_type === 'fixed' ? parseFloat(e.target.value || '0') : parseInt(e.target.value || '0', 10)
                  applyDiscount(item.discount_type ?? 'percentage', value)
                }} />
            </div>
          </div>
          {savingMessage() && <p className="text-xs text-success mt-2">{savingMessage()}</p>}
        </div>}
      </div>
    )
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
            const prices = petiPriceInputPatch(input)
            if (discountOn && item.discount_type) {
              applyDiscount(item.discount_type, item.discount_value, {
                ...prices,
              })
            } else {
              onChange(item.id, prices)
            }
          }}
        />
        {item.price_per_tray_paisa > 0 && (
          <p className="text-xs text-stone-500 mt-1">
            ≈ ₨{(item.price_per_tray_paisa / 100).toFixed(2)} per tray
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
              <label className="label">
                {item.discount_type === 'fixed'
                  ? 'Discount per peti (₨)'
                  : 'Discount (%)'}
              </label>
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
            {lineSavingPaisa > 0 && (
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
