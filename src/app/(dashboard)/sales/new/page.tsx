'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useCustomers } from '@/hooks/use-customers'
import { useEggCategories } from '@/hooks/use-egg-categories'
import { useCurrentStock } from '@/hooks/use-stock'
import SaleItemRow, {
  type SaleItemDraft,
} from '@/components/sales/sale-item-row'
import {
  todayString,
  formatPKR,
  formatQty,
  toPaisa,
  effectiveItemLineTotalPaisa,
  computeDiscountAmountPaisa,
} from '@/lib/utils'
import type { BankAccountBalance } from '@/types'

function accountLabel(account: BankAccountBalance): string {
  if (account.nickname) return account.nickname
  return `${account.bank_name} — ${account.account_holder}`
}

function newItem(): SaleItemDraft {
  return {
    id:                     crypto.randomUUID(),
    egg_category_id:        '',
    quantity_peti:          0,
    quantity_tray:          0,
    price_per_tray_paisa:   0,
    discount_type:          null,
    discount_value:         0,
    discounted_price_paisa: 0,
  }
}

export default function NewSalePage() {
  const router = useRouter()
  const { customers }  = useCustomers()
  const { categories } = useEggCategories()
  const { stock }      = useCurrentStock()

  const [customerId,    setCustomerId]    = useState('')
  const [saleDate,      setSaleDate]      = useState(todayString())
  const [paymentStatus, setPaymentStatus] = useState<
    'paid' | 'partial' | 'unpaid'
  >('unpaid')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [dueDate,           setDueDate]           = useState('')
  const [partialAmount,     setPartialAmount]     = useState('')
  const [partialMethod,     setPartialMethod]     = useState('cash')
  const [partialBankAccountId, setPartialBankAccountId] = useState('')
  const [bankAccounts,  setBankAccounts]  = useState<BankAccountBalance[]>([])
  const [notes,         setNotes]         = useState('')

  const [saleDiscountOn,   setSaleDiscountOn]   = useState(false)
  const [saleDiscountType, setSaleDiscountType] = useState<
    'percentage' | 'fixed'
  >('percentage')
  const [saleDiscountValue, setSaleDiscountValue] = useState('')

  const [items, setItems] = useState<SaleItemDraft[]>([newItem()])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    window.fetch('/api/accounts')
      .then(r => r.json())
      .then((data: BankAccountBalance[]) =>
        setBankAccounts(data.filter(a => a.is_active))
      )
      .catch(console.error)
  }, [])

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

  const subtotalPaisa = useMemo(
    () => items.reduce(
      (sum, item) => sum + effectiveItemLineTotalPaisa(item),
      0,
    ),
    [items],
  )

  const saleDiscountAmountPaisa = useMemo(() => {
    if (!saleDiscountOn) return 0
    const value = saleDiscountType === 'fixed'
      ? parseFloat(saleDiscountValue || '0')
      : parseFloat(saleDiscountValue || '0')
    return computeDiscountAmountPaisa(subtotalPaisa, saleDiscountType, value)
  }, [saleDiscountOn, saleDiscountType, saleDiscountValue, subtotalPaisa])

  const grandTotalPaisa = subtotalPaisa - saleDiscountAmountPaisa

  const totalTrays = items.reduce(
    (sum, item) => sum + item.quantity_peti * 12 + item.quantity_tray,
    0,
  )

  function getAvailableStock(categoryId: string): number {
    return stock.find(s => s.egg_category_id === categoryId)
      ?.quantity_trays ?? 0
  }

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

    if (paymentStatus === 'partial') {
      const paid = parseFloat(partialAmount)
      if (!partialAmount || isNaN(paid) || paid <= 0) {
        setError('Amount paid is required for partial payment')
        return
      }
      if (toPaisa(paid) >= grandTotalPaisa) {
        setError('Partial amount must be less than the sale total')
        return
      }
    }

    setSaving(true)

    try {
      const saleDiscountValueNum = saleDiscountOn
        ? (saleDiscountType === 'fixed'
          ? parseFloat(saleDiscountValue || '0')
          : parseFloat(saleDiscountValue || '0'))
        : 0

      const payload: Record<string, unknown> = {
        customer_id:    customerId,
        sale_date:      saleDate,
        payment_status: paymentStatus,
        notes:          notes || null,
        due_date:       dueDate || null,
        discount_type:  saleDiscountOn ? saleDiscountType : null,
        discount_value: saleDiscountOn ? saleDiscountValueNum : 0,
        discount_amount_paisa: saleDiscountAmountPaisa,
        items: items.map(item => ({
          egg_category_id:        item.egg_category_id,
          quantity_trays:         item.quantity_peti * 12 + item.quantity_tray,
          price_per_tray_paisa:   item.price_per_tray_paisa,
          discount_type:          item.discount_type,
          discount_value:         item.discount_value,
          discounted_price_paisa: item.discounted_price_paisa,
        })),
      }

      if (paymentStatus === 'paid') {
        payload.payment_method = paymentMethod
        if (paymentMethod === 'bank_transfer' && bankAccountId) {
          payload.bank_account_id = bankAccountId
        }
      } else if (paymentStatus === 'partial') {
        payload.amount_paid_paisa = toPaisa(partialAmount)
        payload.payment_method = partialMethod
        if (partialMethod === 'bank_transfer' && partialBankAccountId) {
          payload.bank_account_id = partialBankAccountId
        }
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

          {subtotalPaisa > 0 && (
            <div className="pt-3 border-t border-stone-200 mt-2 space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-stone-500">Subtotal</span>
                <span className="amount text-stone-900">
                  {formatPKR(subtotalPaisa)}
                </span>
              </div>
              {saleDiscountAmountPaisa > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-success">Discount</span>
                  <span className="amount text-success">
                    − {formatPKR(saleDiscountAmountPaisa)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
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
            </div>
          )}
        </div>

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
              <option value="partial">Partial payment</option>
              <option value="paid">Paid — cash on delivery</option>
            </select>
          </div>

          {/* Overall sale discount */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setSaleDiscountOn(v => !v)}
              className={[
                'text-xs font-medium px-2.5 py-1 rounded-md transition-colors',
                saleDiscountOn
                  ? 'bg-brand-100 text-brand-700'
                  : 'bg-stone-200 text-stone-600 hover:bg-stone-300',
              ].join(' ')}
            >
              {saleDiscountOn ? 'Overall discount on' : 'Add overall discount'}
            </button>

            {saleDiscountOn && (
              <div className="space-y-2 pl-1">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSaleDiscountType('percentage')}
                    className={[
                      'flex-1 text-xs font-medium py-1.5 rounded-md border',
                      saleDiscountType === 'percentage'
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-stone-200 text-stone-600',
                    ].join(' ')}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaleDiscountType('fixed')}
                    className={[
                      'flex-1 text-xs font-medium py-1.5 rounded-md border',
                      saleDiscountType === 'fixed'
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
                    step={saleDiscountType === 'fixed' ? '0.01' : '1'}
                    className="input"
                    placeholder="0"
                    value={saleDiscountValue}
                    onChange={e => setSaleDiscountValue(e.target.value)}
                  />
                </div>
                {saleDiscountAmountPaisa > 0 && (
                  <p className="text-xs text-stone-500">
                    Discount: {formatPKR(saleDiscountAmountPaisa)} · Total after
                    discount: {formatPKR(grandTotalPaisa)}
                  </p>
                )}
              </div>
            )}
          </div>

          {paymentStatus === 'unpaid' && (
            <div className="form-group">
              <label className="label">Payment due date</label>
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>
          )}

          {paymentStatus === 'partial' && (
            <>
              <div className="form-group">
                <label className="label">
                  Amount paid (₨) <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  placeholder="0.00"
                  value={partialAmount}
                  onChange={e => setPartialAmount(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="label">Payment method</label>
                <select
                  className="select"
                  value={partialMethod}
                  onChange={e => {
                    setPartialMethod(e.target.value)
                    if (e.target.value !== 'bank_transfer') {
                      setPartialBankAccountId('')
                    }
                  }}
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="jazzcash">JazzCash</option>
                </select>
              </div>

              {partialMethod === 'bank_transfer' && (
                <div className="form-group">
                  <label className="label">Bank account</label>
                  <select
                    className="select"
                    value={partialBankAccountId}
                    onChange={e => setPartialBankAccountId(e.target.value)}
                  >
                    <option value="">Select account…</option>
                    {bankAccounts.map(account => (
                      <option
                        key={account.bank_account_id}
                        value={account.bank_account_id}
                      >
                        {accountLabel(account)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="label">Payment due date</label>
                <input
                  type="date"
                  className="input"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>
            </>
          )}

          {paymentStatus === 'paid' && (
            <>
              <div className="form-group">
                <label className="label">Payment method</label>
                <select
                  className="select"
                  value={paymentMethod}
                  onChange={e => {
                    setPaymentMethod(e.target.value)
                    if (e.target.value !== 'bank_transfer') {
                      setBankAccountId('')
                    }
                  }}
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="easypaisa">Easypaisa</option>
                  <option value="jazzcash">JazzCash</option>
                </select>
              </div>

              {paymentMethod === 'bank_transfer' && (
                <div className="form-group">
                  <label className="label">Bank account</label>
                  <select
                    className="select"
                    value={bankAccountId}
                    onChange={e => setBankAccountId(e.target.value)}
                  >
                    <option value="">Select account…</option>
                    {bankAccounts.map(account => (
                      <option
                        key={account.bank_account_id}
                        value={account.bank_account_id}
                      >
                        {accountLabel(account)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {grandTotalPaisa > 0 && (
                <p className="text-sm text-success">
                  ✓ Full amount {formatPKR(grandTotalPaisa)} collected
                </p>
              )}
            </>
          )}
        </div>

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
