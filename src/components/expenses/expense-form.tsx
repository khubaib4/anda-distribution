'use client'

import { useState, useEffect } from 'react'
import { useExpenseCategories } from '@/hooks/use-expenses'
import { todayString, toPaisa, formatPKR } from '@/lib/utils'
import type { BankAccountBalance, Expense, PartnerOption } from '@/types'

interface Props {
  initial?: Expense
  onSubmit: (values: {
    category_id:     string
    amount_paisa:    number
    expense_date:    string
    description:     string
    vehicle?:        string
    odometer_km?:    number
    worker_name?:    string
    labor_type?:     string
    notes?:          string
    bank_account_id?: string
    paid_by?:        'business' | 'partner'
    paid_by_partner_id?: string
    paid_by_partner_source?: 'profile' | 'partner'
  }) => Promise<void>
  onCancel: () => void
}

function accountLabel(account: BankAccountBalance): string {
  if (account.nickname) return account.nickname
  return `${account.bank_name} — ${account.account_holder}`
}

export default function ExpenseForm({ initial, onSubmit, onCancel }: Props) {
  const isEdit = !!initial
  const { categories } = useExpenseCategories()

  const [categoryId,      setCategoryId]      = useState(initial?.category_id ?? '')
  const [amount,          setAmount]          = useState(
    initial ? String(initial.amount_paisa / 100) : '',
  )
  const [date,            setDate]            = useState(
    initial?.expense_date ?? todayString(),
  )
  const [description,     setDescription]     = useState(initial?.description ?? '')
  const [paidVia,         setPaidVia]         = useState(
    initial?.bank_account_id ? 'bank_transfer' : 'cash',
  )
  const [bankAccountId,   setBankAccountId]   = useState(
    initial?.bank_account_id ?? '',
  )
  const [bankAccounts,    setBankAccounts]    = useState<BankAccountBalance[]>([])
  const [vehicle,         setVehicle]         = useState(initial?.vehicle ?? 'Delivery Van')
  const [odometer,    setOdometer]    = useState(
    initial?.odometer_km != null ? String(initial.odometer_km) : '',
  )
  const [workerName,  setWorkerName]  = useState(initial?.worker_name ?? '')
  const [laborType,   setLaborType]   = useState<'daily' | 'monthly'>(
    initial?.labor_type === 'monthly' ? 'monthly' : 'daily',
  )
  const [notes,       setNotes]       = useState(initial?.notes ?? '')
  const [paidBy,      setPaidBy]      = useState<'business' | 'partner'>(
    initial?.paid_by === 'partner' ? 'partner' : 'business',
  )
  const [paidByPartnerId, setPaidByPartnerId] = useState(
    initial?.paid_by_partner_id ?? '',
  )
  const [paidByPartnerSource, setPaidByPartnerSource] = useState<'profile' | 'partner'>(
    initial?.paid_by_partner_source === 'partner' ? 'partner' : 'profile',
  )
  const [partners,    setPartners]    = useState<PartnerOption[]>([])
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const selectedCategory = categories.find(c => c.id === categoryId)
  const catName          = selectedCategory?.name ?? ''
  const isFuel           = catName === 'Fuel'
  const isLabor          = catName === 'Labor'

  useEffect(() => {
    window.fetch('/api/accounts')
      .then(r => r.json())
      .then((data: BankAccountBalance[]) =>
        setBankAccounts(data.filter(a => a.is_active))
      )
      .catch(console.error)
  }, [])

  useEffect(() => {
    window.fetch('/api/partners')
      .then(r => r.json())
      .then((data: PartnerOption[]) => setPartners(data))
      .catch(console.error)
  }, [])

  const selectedPaidByPartner = partners.find(
    p => p.id === paidByPartnerId && p.source === paidByPartnerSource,
  )

  function handleCategoryChange(id: string) {
    setCategoryId(id)
    if (isEdit) return
    const cat = categories.find(c => c.id === id)
    if (!cat) return
    if (cat.name === 'Fuel')             setDescription('Fuel expense')
    else if (cat.name === 'Rent')        setDescription('Monthly rent')
    else if (cat.name === 'Labor')       setDescription('')
    else if (cat.name === 'Packaging')   setDescription('Packaging materials')
    else if (cat.name === 'Loading/Unloading') setDescription('Loading/Unloading charges')
    else                                 setDescription('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!categoryId)      { setError('Please select a category'); return }
    if (!amount)          { setError('Amount is required'); return }
    if (!description.trim()) { setError('Description is required'); return }

    const amount_paisa = toPaisa(amount)
    if (amount_paisa <= 0) { setError('Amount must be greater than 0'); return }
    if (paidBy === 'partner' && !paidByPartnerId) {
      setError('Please select a partner')
      return
    }

    setSaving(true)
    try {
      await onSubmit({
        category_id:  categoryId,
        amount_paisa,
        expense_date: date,
        description:  description.trim(),
        vehicle:      isFuel  ? vehicle              : undefined,
        odometer_km:  isFuel  ? parseInt(odometer) || undefined : undefined,
        worker_name:  isLabor ? workerName           : undefined,
        labor_type:   isLabor ? laborType            : undefined,
        notes:        notes || undefined,
        paid_by:      paidBy,
        ...(paidBy === 'partner'
          ? {
              paid_by_partner_id:     paidByPartnerId,
              paid_by_partner_source: paidByPartnerSource,
            }
          : {}),
        ...(paidVia === 'bank_transfer' && bankAccountId
          ? { bank_account_id: bankAccountId }
          : {}),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">

      {error && (
        <div className="text-sm text-danger bg-red-50 border border-red-200
                        rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Category */}
      <div className="form-group">
        <label className="label">
          Category <span className="text-danger">*</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {categories.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategoryChange(cat.id)}
              className={[
                'flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm',
                'font-medium transition-colors duration-150 text-left',
                categoryId === cat.id
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
              ].join(' ')}
            >
              <span>{cat.icon}</span>
              <span className="truncate">{cat.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Amount + Date */}
      <div className="form-row">
        <div className="form-group">
          <label className="label">
            Amount (₨) <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            autoFocus
          />
        </div>
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

      {/* Description */}
      <div className="form-group">
        <label className="label">
          Description <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          className="input"
          placeholder="What was this expense for?"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      {/* Fuel-specific fields */}
      {isFuel && (
        <div className="p-3 bg-stone-50 rounded-lg border border-stone-200
                        space-y-3">
          <p className="text-xs font-medium text-stone-500">
            ⛽ Fuel details
          </p>
          <div className="form-group">
            <label className="label">Vehicle</label>
            <input
              type="text"
              className="input"
              value={vehicle}
              onChange={e => setVehicle(e.target.value)}
              placeholder="e.g. Delivery Van"
            />
          </div>
          <div className="form-group">
            <label className="label">Odometer reading (km)</label>
            <input
              type="number"
              min="0"
              className="input"
              placeholder="Optional"
              value={odometer}
              onChange={e => setOdometer(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Labor-specific fields */}
      {isLabor && (
        <div className="p-3 bg-stone-50 rounded-lg border border-stone-200
                        space-y-3">
          <p className="text-xs font-medium text-stone-500">
            👷 Labor details
          </p>
          <div className="form-group">
            <label className="label">Worker name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Raza"
              value={workerName}
              onChange={e => setWorkerName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="label">Payment type</label>
            <select
              className="select"
              value={laborType}
              onChange={e =>
                setLaborType(e.target.value as 'daily' | 'monthly')
              }
            >
              <option value="daily">Daily wage</option>
              <option value="monthly">Monthly salary</option>
            </select>
          </div>
        </div>
      )}

      {/* Paid via */}
      <div className="form-group">
        <label className="label">Paid via</label>
        <select
          className="select"
          value={paidVia}
          onChange={e => {
            setPaidVia(e.target.value)
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

      {paidVia === 'bank_transfer' && (
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

      {/* Paid by */}
      <div className="form-group">
        <label className="label">Paid by</label>
        <select
          className="select"
          value={paidBy}
          onChange={e => {
            const value = e.target.value as 'business' | 'partner'
            setPaidBy(value)
            if (value === 'business') {
              setPaidByPartnerId('')
              setPaidByPartnerSource('profile')
            }
          }}
        >
          <option value="business">Business</option>
          <option value="partner">Partner</option>
        </select>
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
                <option key={`${p.source}:${p.id}`} value={`${p.source}:${p.id}`}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>

          {!isEdit && selectedPaidByPartner && amount && (
            <p className="text-xs text-brand-700 bg-brand-50 border
                          border-brand-200 rounded px-3 py-2">
              This will add {formatPKR(toPaisa(amount))} to{' '}
              {selectedPaidByPartner.full_name}&apos;s capital as a contribution
            </p>
          )}
        </div>
      )}

      {/* Notes */}
      <div className="form-group">
        <label className="label">Notes</label>
        <input
          type="text"
          className="input"
          placeholder="Optional"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary flex-1"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary flex-1"
          disabled={saving}
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save expense'}
        </button>
      </div>
    </form>
  )
}
