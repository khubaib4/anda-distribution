'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  PartnerCapitalSummary,
  CapitalTransaction,
  PartnerOption,
} from '@/types'

interface CapitalData {
  summaries:     PartnerCapitalSummary[]
  transactions:  CapitalTransaction[]
  totalCapital:  number
}

export function partnerOptionValue(partner: PartnerOption): string {
  return `${partner.source}:${partner.id}`
}

export function parsePartnerOptionValue(value: string): {
  partner_id?: string
  partner_profile_id?: string
} {
  const [source, id] = value.split(':')
  if (source === 'profile') return { partner_id: id }
  if (source === 'partner') return { partner_profile_id: id }
  return {}
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
    partner_id?:         string
    partner_profile_id?: string
    type:                'contribution' | 'withdrawal'
    amount_paisa:        number
    transaction_date:    string
    reference?:          string
    notes?:              string
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
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [loading,  setLoading]  = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.fetch('/api/partners')
      if (!res.ok) throw new Error('Failed to load partners')
      const data = await res.json()
      setPartners(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function createPartner(payload: {
    full_name: string
    phone?:    string
  }) {
    const res = await window.fetch('/api/partners', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed to add partner')
    await fetch()
    return json
  }

  return { partners, loading, refetch: fetch, createPartner }
}

export function transactionPartnerName(
  tx: CapitalTransaction,
): string {
  return tx.partner?.full_name ?? tx.simple_partner?.full_name ?? '—'
}

export function transactionPartnerKey(tx: CapitalTransaction): string | null {
  if (tx.partner_id) return `profile:${tx.partner_id}`
  if (tx.partner_profile_id) return `partner:${tx.partner_profile_id}`
  return null
}
