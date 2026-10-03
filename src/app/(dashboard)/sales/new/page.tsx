'use client'

import { formatAccountPKR as formatPKR } from '@/lib/customer-account-money'

import { moneyInputToPaisa, previewCustomerBalance, formatAccountPKR } from '@/lib/customer-account-money'
import { useCustomerAccountRequest } from '@/hooks/use-customer-account-request'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useTenantRouter } from '@/hooks/use-tenant-router'
import { usePostMutationNavigationGuard } from '@/hooks/use-post-mutation-navigation-guard'
import { Plus, ArrowLeft, ArrowRight, FileText } from 'lucide-react'
import SaleDraftPreview from '@/components/sales/sale-draft-preview'
import styles from '@/components/sales/sale-counter.module.css'
import TenantLink from '@/components/tenant-link'
import { useCustomers } from '@/hooks/use-customers'
import { useEggCategories } from '@/hooks/use-egg-categories'
import { useCurrentStock } from '@/hooks/use-stock'
import SaleItemRow, {
  type SaleItemDraft,
} from '@/components/sales/sale-item-row'
import {
  todayString,
  formatQty,
  toPaisa,
  effectiveItemLineTotalPaisa,
  computeDiscountAmountPaisa,
} from '@/lib/utils'
import { cache, createCacheScope } from '@/lib/cache'
import { useTenant } from '@/lib/tenant-client'
import type { BankAccountBalance, CustomerAccountSummary } from '@/types'
import { useTenantFetch } from '@/hooks/use-tenant-fetch'

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
    price_per_peti_paisa:   0,
    discount_type:          null,
    discount_value:         0,
    discounted_price_paisa: 0,
  }
}

export default function NewSalePage() {
  const router = useTenantRouter()
  const canNavigateAfterMutation = usePostMutationNavigationGuard()
  const { userId, tenantId } = useTenant()
  const tenantFetch = useTenantFetch()
  const { customers }  = useCustomers({ module: 'sales' })
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
  const { withRequestId, resetRequest } = useCustomerAccountRequest()
  const [account, setAccount] = useState<CustomerAccountSummary | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [amountReceived, setAmountReceived] = useState('')
  const [allocationMode, setAllocationMode] = useState<'old_first' | 'sale_only'>('old_first')
  const [useAdvance, setUseAdvance] = useState(false)
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [notes,         setNotes]         = useState('')

  const [saleDiscountOn,   setSaleDiscountOn]   = useState(false)
  const [saleDiscountType, setSaleDiscountType] = useState<
    'percentage' | 'fixed'
  >('percentage')
  const [saleDiscountValue, setSaleDiscountValue] = useState('')

  const [items, setItems] = useState<SaleItemDraft[]>([newItem()])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    tenantFetch('/api/accounts')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load accounts')
        return r.json()
      })
      .then((data: BankAccountBalance[]) =>
        setBankAccounts(data.filter(a => a.is_active))
      )
      .catch(console.error)
  }, [tenantFetch])

  useEffect(() => {
    let cancelled = false
    if (!customerId) return
    tenantFetch(`/api/customers/${customerId}/account-summary?module=sales`)
      .then(async res => {if (!res.ok) throw new Error('Unable to load the latest customer balance'); return res.json()})
      .then(data => {if (!cancelled) setAccount(data)})
      .catch(() => {if (!cancelled) setBalanceError('Unable to load the latest customer balance. Select the customer again to retry.')})
      .finally(() => {if (!cancelled) setBalanceLoading(false)})
    return () => {cancelled = true}
  }, [customerId, tenantFetch])

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

  const receivedPaisa = moneyInputToPaisa(amountReceived)
  const advancePaisa = useAdvance ? moneyInputToPaisa(advanceAmount) : 0
  const balancePreview = account?.accounts_enabled ? previewCustomerBalance(account, grandTotalPaisa,
    receivedPaisa ?? 0, advancePaisa ?? 0, allocationMode) : null

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
    const mutationScope = createCacheScope(userId, tenantId)
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

    if (!account || balanceLoading || balanceError) {setError(balanceError ?? 'Wait for the customer balance to load');return}
    if (account.accounts_enabled && (receivedPaisa === null || advancePaisa === null || (useAdvance && advancePaisa <= 0) || advancePaisa > (balancePreview?.max_advance_paisa ?? 0))) {
      setError('Enter valid amounts and use no more than the available advance and eligible balance');return
    }

    if (!account.accounts_enabled && paymentStatus === 'partial') {
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
          price_per_peti_paisa:   item.price_per_peti_paisa,
          discount_type:          item.discount_type,
          discount_value:         item.discount_value,
          discounted_price_paisa: item.discounted_price_paisa,
        })),
      }

      if (account.accounts_enabled) {
        delete payload.payment_status
        payload.amount_received_paisa = receivedPaisa
        payload.advance_paisa = advancePaisa
        payload.allocation_mode = allocationMode
        payload.payment_method = paymentMethod
        if (paymentMethod === 'bank_transfer' && bankAccountId) payload.bank_account_id = bankAccountId
      } else if (paymentStatus === 'paid') {
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

      const res = await tenantFetch('/api/sales', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(account.accounts_enabled ? withRequestId(payload) : payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to save sale')
        if (res.status === 409 && account.accounts_enabled) {
          const latest = await tenantFetch(`/api/customers/${customerId}/account-summary?module=sales`)
          if (latest.ok) setAccount(await latest.json())
        }
        setSaving(false)
        return
      }

      resetRequest()
      if (mutationScope) cache.invalidatePattern(mutationScope, '/api/')
      if (!canNavigateAfterMutation()) return
      router.push('/sales')
    } catch {
      setError(account?.accounts_enabled ? 'Network error — retry with the same details to avoid a duplicate' : 'Network error — please try again')
      setSaving(false)
    }
  }

  const selectedCustomer = customers.find(customer => customer.customer_id === customerId)
  const receivedForSummary = account?.accounts_enabled
    ? receivedPaisa
    : paymentStatus === 'paid' ? grandTotalPaisa
      : paymentStatus === 'partial' ? moneyInputToPaisa(partialAmount) : 0
  const closingReady = balancePreview && receivedPaisa !== null && advancePaisa !== null
    && advancePaisa <= balancePreview.max_advance_paisa && (!useAdvance || advancePaisa > 0)

  return (
    <div className={styles.page}>
      <TenantLink href="/sales" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Sales
      </TenantLink>
      <div className={styles.header}>
        <div><h1 className={styles.title}>New sale</h1><p className={styles.subtitle}>Enter eggs, then settle the payment.</p></div>
        <button type="button" onClick={() => setPreviewOpen(true)} className="btn-secondary" disabled={saving}>
          <FileText className="w-4 h-4" /> Preview
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className={styles.layout}>
        <div className={styles.sections}>
          <section className={styles.panel} aria-labelledby="sale-customer-heading">
            <div className={styles.sectionHeading}><h2 id="sale-customer-heading">Customer & date</h2></div>
            <div className={styles.customerFields}>
              <div>
                <label className="label" htmlFor="sale-customer">Customer <span className="text-danger">*</span></label>
                <select id="sale-customer" className="select" value={customerId} required
                  onChange={e => {setCustomerId(e.target.value);setAccount(null);setBalanceError(null);setUseAdvance(false);setAdvanceAmount('');setBalanceLoading(Boolean(e.target.value))}}>
                  <option value="">Select customer…</option>
                  {customers.map(customer => <option key={customer.customer_id} value={customer.customer_id}>
                    {customer.contact_name}{customer.business_name ? ` — ${customer.business_name}` : ''}
                  </option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sale-date">Sale date</label>
                <input id="sale-date" type="date" className="input" value={saleDate} max={todayString()} onChange={e => setSaleDate(e.target.value)} required />
              </div>
            </div>
            {balanceLoading && <p className={styles.hint} role="status">Loading customer balance…</p>}
            {balanceError && <p role="alert" className="text-sm text-danger mt-3">{balanceError}</p>}
            {account?.accounts_enabled && <div className={styles.balances}>
              <p>Previous due<strong className="text-danger">{formatAccountPKR(account.due_paisa)}</strong></p>
              <p>Available advance<strong className="text-success">{formatAccountPKR(account.advance_paisa)}</strong></p>
            </div>}
          </section>

          <section className={styles.panel} aria-labelledby="sale-items-heading">
            <div className={styles.sectionHeading}><h2 id="sale-items-heading">Egg items</h2><span>12 trays / peti</span></div>
            {stock.length > 0 && <div className={styles.stock}>
              <span>Available stock</span>
              {stock.map(category => <span key={category.egg_category_id}>{category.egg_category}<strong>{formatQty(category.quantity_trays)}</strong></span>)}
            </div>}
            {items.map(item => <SaleItemRow key={item.id} item={item} categories={categories} layout="counter"
              onChange={handleItemChange} onRemove={handleItemRemove} canRemove={items.length > 1} />)}
            <button type="button" onClick={handleAddItem} className={`btn-secondary ${styles.addItem}`}>
              <Plus className="w-4 h-4" /> Add another category
            </button>
          </section>

          <section className={styles.panel} aria-labelledby="sale-payment-heading">
            <div className={styles.sectionHeading}><h2 id="sale-payment-heading">Payment</h2></div>
            {account?.accounts_enabled ? <>
              <div className={styles.paymentFields}>
                <div>
                  <label className="label" htmlFor="sale-received">Amount received (Rs)</label>
                  <input id="sale-received" type="number" min="0" step="0.01" className="input" placeholder="0.00" value={amountReceived} onChange={e => setAmountReceived(e.target.value)} />
                  <p className={styles.hint}>Only new money received today. Any extra becomes advance.</p>
                </div>
                <div>
                  <label className="label" htmlFor="sale-method">Payment method</label>
                  <select id="sale-method" className="select" value={paymentMethod} onChange={e => {setPaymentMethod(e.target.value);setBankAccountId('')}}>
                    <option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option>
                  </select>
                </div>
              </div>
              {paymentMethod === 'bank_transfer' && <div className="mt-3">
                <label className="label" htmlFor="sale-bank">Bank account</label>
                <select id="sale-bank" className="select" value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
                  <option value="">Select account…</option>{bankAccounts.map(bank => <option key={bank.bank_account_id} value={bank.bank_account_id}>{accountLabel(bank)}</option>)}
                </select>
              </div>}
              <fieldset className={styles.allocation}>
                <legend className="label">Apply payment to</legend>
                <div className={styles.radioGroup}>
                  <label className={styles.choice}><input type="radio" name="sale-allocation" value="old_first" checked={allocationMode === 'old_first'} onChange={() => setAllocationMode('old_first')} />Old balance first</label>
                  <label className={styles.choice}><input type="radio" name="sale-allocation" value="sale_only" checked={allocationMode === 'sale_only'} onChange={() => setAllocationMode('sale_only')} />This sale only</label>
                </div>
                <p className={styles.hint}>{allocationMode === 'old_first' ? 'Settle previous due, then the oldest unpaid invoices.' : 'Other unpaid balances stay unchanged.'}</p>
              </fieldset>
              {account.advance_paisa > 0 && <div className={styles.advance}>
                <label className={styles.choice}><input type="checkbox" checked={useAdvance} onChange={e => setUseAdvance(e.target.checked)} />Use advance — available {formatAccountPKR(account.advance_paisa)}</label>
                {useAdvance && <div className="mt-3">
                  <label className="label" htmlFor="sale-advance">Advance to use (Rs)</label>
                  <input id="sale-advance" type="number" min="0" step="0.01" className="input" value={advanceAmount} onChange={e => setAdvanceAmount(e.target.value)} />
                  <p className={styles.hint}>This uses money already received; it does not add a new cash receipt.</p>
                </div>}
              </div>}
            </> : <>
              <div>
                <label className="label" htmlFor="sale-payment-status">Payment status</label>
                <select id="sale-payment-status" className="select" value={paymentStatus} onChange={e => setPaymentStatus(e.target.value as 'paid' | 'partial' | 'unpaid')}>
                  <option value="unpaid">Unpaid — collect later</option><option value="partial">Partial payment</option><option value="paid">Paid — cash on delivery</option>
                </select>
              </div>
              {paymentStatus === 'partial' && <div className="mt-3">
                <label className="label" htmlFor="sale-partial">Amount paid (Rs)</label>
                <input id="sale-partial" type="number" min="0" step="0.01" className="input" placeholder="0.00" value={partialAmount} onChange={e => setPartialAmount(e.target.value)} />
              </div>}
              {paymentStatus !== 'unpaid' && <div className="mt-3 space-y-3">
                <div>
                  <label className="label" htmlFor="sale-legacy-method">Payment method</label>
                  <select id="sale-legacy-method" className="select" value={paymentStatus === 'partial' ? partialMethod : paymentMethod} onChange={e => {
                    if (paymentStatus === 'partial') {setPartialMethod(e.target.value);if (e.target.value !== 'bank_transfer') setPartialBankAccountId('')}
                    else {setPaymentMethod(e.target.value);if (e.target.value !== 'bank_transfer') setBankAccountId('')}
                  }}>
                    <option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="easypaisa">Easypaisa</option><option value="jazzcash">JazzCash</option>
                  </select>
                </div>
                {(paymentStatus === 'partial' ? partialMethod : paymentMethod) === 'bank_transfer' && <div>
                  <label className="label" htmlFor="sale-legacy-bank">Bank account</label>
                  <select id="sale-legacy-bank" className="select" value={paymentStatus === 'partial' ? partialBankAccountId : bankAccountId}
                    onChange={e => paymentStatus === 'partial' ? setPartialBankAccountId(e.target.value) : setBankAccountId(e.target.value)}>
                    <option value="">Select account…</option>{bankAccounts.map(bank => <option key={bank.bank_account_id} value={bank.bank_account_id}>{accountLabel(bank)}</option>)}
                  </select>
                </div>}
                {paymentStatus === 'paid' && grandTotalPaisa > 0 && <p className="text-sm text-success">Full amount {formatPKR(grandTotalPaisa)} collected</p>}
              </div>}
            </>}

            <details className={styles.details}>
              <summary>Due date, overall discount & notes</summary>
              <div className={styles.detailsBody}>
                <div>
                  <label className="label" htmlFor="sale-due-date">Payment due date</label>
                  <input id="sale-due-date" type="date" className="input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
                <div>
                  <label className={styles.choice}><input type="checkbox" checked={saleDiscountOn} onChange={e => setSaleDiscountOn(e.target.checked)} />Overall discount</label>
                  {saleDiscountOn && <div className={styles.discountFields}>
                    <div>
                      <label className="label" htmlFor="sale-discount-type">Discount type</label>
                      <select id="sale-discount-type" className="select" value={saleDiscountType} onChange={e => setSaleDiscountType(e.target.value as 'percentage' | 'fixed')}>
                        <option value="percentage">Percentage</option><option value="fixed">Rupees off total</option>
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="sale-discount-value">Discount {saleDiscountType === 'fixed' ? '(Rs)' : '(%)'}</label>
                      <input id="sale-discount-value" type="number" min="0" step={saleDiscountType === 'fixed' ? '0.01' : '1'} className="input" placeholder="0" value={saleDiscountValue} onChange={e => setSaleDiscountValue(e.target.value)} />
                    </div>
                  </div>}
                </div>
                <div>
                  <label className="label" htmlFor="sale-notes">Notes</label>
                  <textarea id="sale-notes" className="textarea" rows={2} placeholder="Any notes about this sale…" value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
              </div>
            </details>
          </section>
        </div>

        <aside className={`${styles.panel} ${styles.summary}`} aria-labelledby="sale-summary-heading">
          <div className={styles.summaryHeading}><h2 id="sale-summary-heading">Sale summary</h2><p>{selectedCustomer?.contact_name ?? 'Select a customer'}</p></div>
          <dl className={styles.summaryRows} aria-live="polite">
            <div className={styles.summaryRow}><dt>Egg items · {totalTrays} trays</dt><dd>{formatPKR(subtotalPaisa)}</dd></div>
            {saleDiscountAmountPaisa > 0 && <div className={styles.summaryRow}><dt>Overall discount</dt><dd className="text-success">− {formatPKR(saleDiscountAmountPaisa)}</dd></div>}
            <div className={`${styles.summaryRow} ${styles.grandTotal}`}><dt>This sale</dt><dd>{formatPKR(grandTotalPaisa)}</dd></div>
            {account?.accounts_enabled && <div className={styles.summaryRow}><dt>Previous due</dt><dd>{formatAccountPKR(account.due_paisa)}</dd></div>}
            <div className={styles.summaryRow}><dt>Received today</dt><dd>{receivedForSummary === null ? '—' : formatPKR(receivedForSummary)}</dd></div>
            {account?.accounts_enabled && useAdvance && <div className={styles.summaryRow}><dt>Advance used</dt><dd>{advancePaisa === null ? '—' : formatAccountPKR(advancePaisa)}</dd></div>}
          </dl>
          {closingReady && balancePreview && <dl className={styles.closing} aria-live="polite">
            <div className={styles.summaryRow}><dt>Customer due after sale</dt><dd className="text-danger">{formatAccountPKR(Math.max(0, balancePreview.due_paisa))}</dd></div>
            <div className={styles.summaryRow}><dt>Advance remaining</dt><dd className="text-success">{formatAccountPKR(Math.max(0, balancePreview.advance_paisa))}</dd></div>
          </dl>}
          {balanceLoading && <p className={styles.hint} role="status">Loading customer balance…</p>}
          {account?.accounts_enabled && !closingReady && <p className={styles.hint}>Enter valid payment and advance amounts to see the closing balance.</p>}
          {error && <div role="alert" className={styles.error}>{error}</div>}
          <button type="submit" disabled={saving} className={`btn-primary ${styles.save}`}>
            {saving ? 'Saving…' : 'Save sale'}<ArrowRight className="w-4 h-4" />
          </button>
          <div className={styles.secondaryActions}>
            <TenantLink href="/sales" className="btn-ghost text-xs">Cancel</TenantLink>
            <button type="button" className="btn-ghost text-xs" onClick={() => setPreviewOpen(true)} disabled={saving}>Preview invoice</button>
          </div>
          <p className={styles.conversion}>1 peti = 12 trays · 360 eggs</p>
          <p className="text-center text-2xs text-stone-400 mt-2">Invoice number assigned on save</p>
        </aside>
      </form>
      <SaleDraftPreview open={previewOpen} onClose={() => setPreviewOpen(false)} customerName={selectedCustomer?.contact_name ?? ''}
        saleDate={saleDate} items={items} categories={categories} subtotal={subtotalPaisa} discount={saleDiscountAmountPaisa}
        total={grandTotalPaisa} notes={notes} closingDue={closingReady && balancePreview ? Math.max(0, balancePreview.due_paisa) : undefined}
        closingAdvance={closingReady && balancePreview ? Math.max(0, balancePreview.advance_paisa) : undefined} />
    </div>
  )
}
