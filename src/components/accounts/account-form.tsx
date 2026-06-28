'use client'

import { useState, useRef, useEffect } from 'react'
import { PAKISTANI_BANKS } from '@/lib/pakistani-banks'
import type { BankAccountBalance } from '@/types'

interface Props {
  initial?: BankAccountBalance
  onSubmit: (values: {
    bank_name:      string
    account_holder: string
    account_number: string
    nickname:       string
  }) => Promise<void>
  onCancel:     () => void
  submitLabel?: string
}

export default function AccountForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: Props) {
  const [bankName,      setBankName]      = useState(initial?.bank_name      ?? '')
  const [accountHolder, setAccountHolder] = useState(initial?.account_holder ?? '')
  const [accountNumber, setAccountNumber] = useState(initial?.account_number ?? '')
  const [nickname,      setNickname]      = useState(initial?.nickname       ?? '')
  const [bankQuery,     setBankQuery]     = useState(initial?.bank_name      ?? '')
  const [showBanks,     setShowBanks]     = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  const bankRef = useRef<HTMLDivElement>(null)

  const filteredBanks = PAKISTANI_BANKS.filter(b =>
    b.toLowerCase().includes(bankQuery.toLowerCase())
  )

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (bankRef.current && !bankRef.current.contains(e.target as Node)) {
        setShowBanks(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function selectBank(name: string) {
    setBankName(name)
    setBankQuery(name)
    setShowBanks(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!bankName.trim()) {
      setError('Bank name is required')
      return
    }
    if (!accountHolder.trim()) {
      setError('Account holder is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        bank_name:      bankName,
        account_holder: accountHolder,
        account_number: accountNumber,
        nickname,
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

        <div className="form-group" ref={bankRef}>
          <label className="label">
            Bank name <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="Search or select bank…"
            value={bankQuery}
            onChange={e => {
              setBankQuery(e.target.value)
              setBankName(e.target.value)
              setShowBanks(true)
            }}
            onFocus={() => setShowBanks(true)}
            autoFocus
            required
          />
          {showBanks && filteredBanks.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto border border-stone-200
                           rounded-lg bg-white shadow-sm">
              {filteredBanks.map(bank => (
                <li key={bank}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-stone-700
                               hover:bg-stone-50"
                    onClick={() => selectBank(bank)}
                  >
                    {bank}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-group">
          <label className="label">
            Account holder <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Haris Ahmed"
            value={accountHolder}
            onChange={e => setAccountHolder(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label className="label">Account number</label>
          <input
            type="text"
            className="input"
            placeholder="Optional"
            value={accountNumber}
            onChange={e => setAccountNumber(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="label">Nickname</label>
          <input
            type="text"
            className="input"
            placeholder='e.g. "Haris Meezan"'
            value={nickname}
            onChange={e => setNickname(e.target.value)}
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
