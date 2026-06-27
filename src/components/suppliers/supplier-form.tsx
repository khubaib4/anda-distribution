'use client'

import { useState } from 'react'
import type { Supplier } from '@/types'

interface Props {
  initial?: Supplier
  onSubmit: (values: {
    name: string
    phone: string
    address: string
    notes: string
  }) => Promise<void>
  onCancel: () => void
  submitLabel?: string
}

export default function SupplierForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: Props) {
  const [name,    setName]    = useState(initial?.name    ?? '')
  const [phone,   setPhone]   = useState(initial?.phone   ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [notes,   setNotes]   = useState(initial?.notes   ?? '')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Supplier name is required'); return }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ name, phone, address, notes })
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
            Supplier name <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Ahmed Poultry Farm"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div className="form-group">
          <label className="label">Phone number</label>
          <input
            type="tel"
            className="input"
            placeholder="e.g. 0300-1234567"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="label">Address</label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Landhi, Karachi"
            value={address}
            onChange={e => setAddress(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="label">Notes</label>
          <textarea
            className="textarea"
            placeholder="Any additional notes…"
            rows={2}
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
