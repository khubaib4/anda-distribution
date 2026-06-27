'use client'

import { useState } from 'react'
import { useExpenseCategories } from '@/hooks/use-expenses'
import { todayString, toPaisa } from '@/lib/utils'

interface Props {
  onSubmit: (values: {
    category_id:  string
    amount_paisa: number
    expense_date: string
    description:  string
    vehicle?:     string
    odometer_km?: number
    worker_name?: string
    labor_type?:  string
    notes?:       string
  }) => Promise<void>
  onCancel: () => void
}

export default function ExpenseForm({ onSubmit, onCancel }: Props) {
  const { categories } = useExpenseCategories()

  const [categoryId,  setCategoryId]  = useState('')
  const [amount,      setAmount]      = useState('')
  const [date,        setDate]        = useState(todayString())
  const [description, setDescription] = useState('')
  const [vehicle,     setVehicle]     = useState('Delivery Van')
  const [odometer,    setOdometer]    = useState('')
  const [workerName,  setWorkerName]  = useState('')
  const [laborType,   setLaborType]   = useState<'daily' | 'monthly'>('daily')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const selectedCategory = categories.find(c => c.id === categoryId)
  const catName          = selectedCategory?.name ?? ''
  const isFuel           = catName === 'Fuel'
  const isLabor          = catName === 'Labor'

  // Auto-set description based on category
  function handleCategoryChange(id: string) {
    setCategoryId(id)
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
          {saving ? 'Saving…' : 'Save expense'}
        </button>
      </div>
    </form>
  )
}
