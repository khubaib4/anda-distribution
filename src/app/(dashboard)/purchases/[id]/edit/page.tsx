'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useSuppliers } from '@/hooks/use-suppliers'
import { useEggCategories } from '@/hooks/use-egg-categories'
import PurchaseItemRow, {
  type PurchaseItemDraft,
} from '@/components/purchases/purchase-item-row'
import { SkeletonList } from '@/components/ui/skeleton'
import { todayString, formatPKR } from '@/lib/utils'
import type { PartnerOption, Purchase } from '@/types'

function newItem(): PurchaseItemDraft {
  return {
    id:                   crypto.randomUUID(),
    egg_category_id:      '',
    quantity_peti:        0,
    quantity_tray:        0,
    price_per_tray_paisa: 0,
  }
}

function purchaseToItems(purchase: Purchase): PurchaseItemDraft[] {
  return (purchase.items ?? []).map(item => ({
    id:                   item.id,
    egg_category_id:      item.egg_category_id ?? item.egg_category?.id ?? '',
    quantity_peti:        Math.floor(item.quantity_trays / 12),
    quantity_tray:        item.quantity_trays % 12,
    price_per_tray_paisa: item.price_per_tray_paisa,
  }))
}

export default function EditPurchasePage() {
  const router = useRouter()
  const params = useParams()
  const purchaseId = params.id as string

  const { suppliers } = useSuppliers()
  const { categories } = useEggCategories()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)

  const [supplierId,     setSupplierId]     = useState('')
  const [supplierName,   setSupplierName]   = useState('')
  const [purchaseDate,   setPurchaseDate]   = useState(todayString())
  const [paymentStatus,  setPaymentStatus]  = useState<'paid' | 'partial' | 'unpaid'>('unpaid')
  const [amountPaid,     setAmountPaid]     = useState('')
  const [notes,          setNotes]          = useState('')
  const [paidBy,         setPaidBy]         = useState<'business' | 'partner'>('business')
  const [paidByPartnerId, setPaidByPartnerId] = useState('')
  const [paidByPartnerSource, setPaidByPartnerSource] =
    useState<'profile' | 'partner'>('profile')
  const [partners,       setPartners]       = useState<PartnerOption[]>([])

  const [items, setItems] = useState<PurchaseItemDraft[]>([newItem()])

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    window.fetch('/api/partners')
      .then(r => r.json())
      .then((data: PartnerOption[]) => setPartners(data))
      .catch(console.error)
  }, [])

  useEffect(() => {
    setLoading(true)
    setLoadError(null)

    window.fetch(`/api/purchases/${purchaseId}`)
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Failed to load purchase')
        return data as Purchase
      })
      .then(purchase => {
        setInvoiceNumber(purchase.invoice_number)
        setSupplierId(purchase.supplier_id ?? '')
        setSupplierName(
          purchase.supplier_id
            ? ''
            : purchase.supplier_name_snapshot ?? '',
        )
        setPurchaseDate(purchase.purchase_date)
        setPaymentStatus(purchase.payment_status)
        setAmountPaid(
          purchase.amount_paid_paisa
            ? String(purchase.amount_paid_paisa / 100)
            : '',
        )
        setNotes(purchase.notes ?? '')
        setPaidBy(purchase.paid_by === 'partner' ? 'partner' : 'business')
        setPaidByPartnerId(purchase.paid_by_partner_id ?? '')
        setPaidByPartnerSource(
          purchase.paid_by_partner_source === 'partner' ? 'partner' : 'profile',
        )
        setItems(
          purchase.items && purchase.items.length > 0
            ? purchaseToItems(purchase)
            : [newItem()],
        )
      })
      .catch(err => {
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load purchase',
        )
      })
      .finally(() => setLoading(false))
  }, [purchaseId])

  const selectedPaidByPartner = partners.find(
    p => p.id === paidByPartnerId && p.source === paidByPartnerSource,
  )

  const handleItemChange = useCallback(
    (id: string, patch: Partial<PurchaseItemDraft>) => {
      setItems(prev =>
        prev.map(item => (item.id === id ? { ...item, ...patch } : item))
      )
    },
    [],
  )

  const handleItemRemove = useCallback((id: string) => {
    setItems(prev => prev.filter(item => item.id !== id))
  }, [])

  const handleAddItem = () => setItems(prev => [...prev, newItem()])

  const grandTotalPaisa = items.reduce((sum, item) => {
    const trays = item.quantity_peti * 12 + item.quantity_tray
    return sum + trays * item.price_per_tray_paisa
  }, 0)

  const totalTrays = items.reduce(
    (sum, item) => sum + item.quantity_peti * 12 + item.quantity_tray,
    0,
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

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

    if (paidBy === 'partner' && !paidByPartnerId) {
      setError('Please select a partner')
      return
    }

    setSaving(true)

    try {
      const selectedSupplier = suppliers.find(s => s.supplier_id === supplierId)

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
        paid_by: paidBy,
        ...(paidBy === 'partner'
          ? {
              paid_by_partner_id:     paidByPartnerId,
              paid_by_partner_source: paidByPartnerSource,
            }
          : {}),
      }

      const res = await fetch(`/api/purchases/${purchaseId}`, {
        method:  'PATCH',
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

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link
            href="/purchases"
            className="inline-flex items-center gap-1.5 text-sm text-stone-500
                       hover:text-stone-700 mb-3 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Purchases
          </Link>
          <h1 className="page-title">Edit purchase</h1>
        </div>
        <SkeletonList count={4} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link
            href="/purchases"
            className="inline-flex items-center gap-1.5 text-sm text-stone-500
                       hover:text-stone-700 mb-3 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Purchases
          </Link>
          <h1 className="page-title">Edit purchase</h1>
        </div>
        <div className="text-sm text-danger bg-red-50 border border-red-200
                        rounded px-4 py-3">
          {loadError}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link
          href="/purchases"
          className="inline-flex items-center gap-1.5 text-sm text-stone-500
                     hover:text-stone-700 mb-3 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Purchases
        </Link>
        <h1 className="page-title">Edit purchase</h1>
        {invoiceNumber && (
          <p className="page-subtitle font-mono">{invoiceNumber}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
                  <option key={s.supplier_id} value={s.supplier_id}>{s.name}</option>
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
              max={todayString()}
              onChange={e => setPurchaseDate(e.target.value)}
              required
            />
          </div>
        </div>

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

          <div className="form-group">
            <label className="label">Paid by</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setPaidBy('business')
                  setPaidByPartnerId('')
                  setPaidByPartnerSource('profile')
                }}
                className={[
                  'py-2.5 rounded-lg border text-sm font-medium transition-colors',
                  paidBy === 'business'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50',
                ].join(' ')}
              >
                Business
              </button>
              <button
                type="button"
                onClick={() => setPaidBy('partner')}
                className={[
                  'py-2.5 rounded-lg border text-sm font-medium transition-colors',
                  paidBy === 'partner'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50',
                ].join(' ')}
              >
                Partner
              </button>
            </div>
          </div>

          {paidBy === 'partner' && (
            <div className="space-y-3">
              <div className="form-group">
                <label className="label">
                  Partner <span className="text-danger">*</span>
                </label>
                <select
                  className="select"
                  value={
                    paidByPartnerId
                      ? `${paidByPartnerSource}:${paidByPartnerId}`
                      : ''
                  }
                  onChange={e => {
                    const value = e.target.value
                    if (!value) {
                      setPaidByPartnerId('')
                      setPaidByPartnerSource('profile')
                      return
                    }
                    const [source, id] = value.split(':')
                    setPaidByPartnerId(id)
                    setPaidByPartnerSource(
                      source === 'partner' ? 'partner' : 'profile',
                    )
                  }}
                >
                  <option value="">Select partner…</option>
                  {partners.map(p => (
                    <option
                      key={`${p.source}:${p.id}`}
                      value={`${p.source}:${p.id}`}
                    >
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedPaidByPartner && grandTotalPaisa > 0 && (
                <p className="text-xs text-brand-700 bg-brand-50 border
                              border-brand-200 rounded px-3 py-2">
                  Paid by {selectedPaidByPartner.full_name}
                </p>
              )}
            </div>
          )}
        </div>

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
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
