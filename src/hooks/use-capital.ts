'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  PartnerCapitalSummary,
  CapitalTransaction,
  Profile,
} from '@/types'

interface CapitalData {
  summaries:     PartnerCapitalSummary[]
  transactions:  CapitalTransaction[]
  totalCapital:  number
}

export function useCapital() {
  const [data,    setData]    = useState<CapitalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch('/api/capital')
      if (!res.ok) throw new Error('Failed to load capital data')
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function createTransaction(payload: {
    partner_id:       string
    type:             'contribution' | 'withdrawal'
    amount_paisa:     number
    transaction_date: string
    reference?:       string
    notes?:           string
  }) {
    const res = await window.fetch('/api/capital', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed to record transaction')
    await fetch()
    return json
  }

  return { data, loading, error, refetch: fetch, createTransaction }
}

export function usePartners() {
  const [partners, setPartners] = useState<Profile[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    window.fetch('/api/profiles')
      .then(r => r.json())
      .then(data => setPartners(data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { partners, loading }
}
