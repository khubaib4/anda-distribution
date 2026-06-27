'use client'

import { useState } from 'react'
import type { CustomerBalance } from '@/types'

type CustomerFormInitial = CustomerBalance & {
  address?: string | null
  notes?:   string | null
}

interface Props {
  initial?:    CustomerFormInitial
  onSubmit:    (values: {
    contact_name:  string
    business_name: string
    phone:         string
    address:       string
    customer_type: string
    notes:         string
  }) => Promise<void>
  onCancel:    () => void
  submitLabel?: string
}

const customerTypes = [
  { value: '',            label: 'Select type…' },
  { value: 'shop',        label: 'Shop'         },
  { value: 'restaurant',  label: 'Restaurant'   },
  { value: 'wholesaler',  label: 'Wholesaler'   },
  { value: 'other',       label: 'Other'        },
]

export default function CustomerForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: Props) {
  const [contactName,   setContactName]   = useState(initial?.contact_name   ?? '')
  const [businessName,  setBusinessName]  = useState(initial?.business_name  ?? '')
  const [phone,         setPhone]         = useState(initial?.phone          ?? '')
  const [address,       setAddress]       = useState(initial?.address        ?? '')
  const [customerType,  setCustomerType]  = useState(initial?.customer_type  ?? '')
  const [notes,         setNotes]         = useState(initial?.notes          ?? '')
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contactName.trim()) {
      setError('Contact name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        contact_name:  contactName,
        business_name: businessName,
        phone,
        address,
        customer_type: customerType,
        notes,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="modal-body">

        {error && (
          <div className="text-sm text-danger bg-red-50 border border-red-200
                          rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="form-group">
          <label className="label">
            Contact name <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Ali Khan"
            value={contactName}
            onChange={e => setContactName(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div className="form-group">
          <label className="label">Business / shop name</label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Ali General Store"
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="label">Phone</label>
            <input
              type="tel"
              className="input"
              placeholder="0300-1234567"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="label">Type</label>
            <select
              className="select"
              value={customerType}
              onChange={e => setCustomerType(e.target.value)}
            >
              {customerTypes.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="label">Address</label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Shop 5, Saddar, Karachi"
            value={address}
            onChange={e => setAddress(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="label">Notes</label>
          <textarea
            className="textarea"
            rows={2}
            placeholder="Any notes about this customer…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

      </div>

      <div className="modal-footer">
        <button
          type="button"
          onClick={onCancel}
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
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
