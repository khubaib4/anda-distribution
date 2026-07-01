import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import type { PartnerCapitalSummary } from '@/types'

type SummaryKey = string

function summaryKey(source: 'profile' | 'partner', id: string): SummaryKey {
  return `${source}:${id}`
}

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  if (!tenantId) {
    return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('owner_id')
    .eq('id', tenantId)
    .maybeSingle()

  let profilesQuery = tenantEq(
    supabase
      .from('profiles')
      .select('id, full_name'),
    tenantId,
  )

  if (tenant?.owner_id) {
    profilesQuery = profilesQuery.or(
      `role.eq.partner,id.eq.${tenant.owner_id}`,
    )
  } else {
    profilesQuery = profilesQuery.eq('role', 'partner')
  }

  let transactionsQuery = supabase
    .from('capital_transactions')
    .select(`
      *,
      partner:profiles!capital_transactions_partner_id_fkey(
        id, full_name
      ),
      simple_partner:partners!capital_transactions_partner_profile_id_fkey(
        id, full_name
      )
    `)
    .order('transaction_date', { ascending: false })
    .order('created_at',       { ascending: false })
  transactionsQuery = tenantEq(transactionsQuery, tenantId)

  const [profilesResult, partnersResult, transactionsResult] = await Promise.all([
    profilesQuery.order('full_name'),
    tenantEq(
      supabase
        .from('partners')
        .select('id, full_name')
        .eq('is_active', true),
      tenantId,
    ).order('full_name'),
    transactionsQuery,
  ])

  if (profilesResult.error) {
    return NextResponse.json(
      { error: profilesResult.error.message },
      { status: 500 },
    )
  }
  if (partnersResult.error) {
    return NextResponse.json(
      { error: partnersResult.error.message },
      { status: 500 },
    )
  }
  if (transactionsResult.error) {
    return NextResponse.json(
      { error: transactionsResult.error.message },
      { status: 500 },
    )
  }

  const summaryMap = new Map<SummaryKey, PartnerCapitalSummary>()

  for (const profile of profilesResult.data ?? []) {
    summaryMap.set(summaryKey('profile', profile.id), {
      id:                      profile.id,
      source:                  'profile',
      full_name:               profile.full_name,
      total_contributed_paisa: 0,
      total_withdrawn_paisa:   0,
      net_capital_paisa:       0,
    })
  }

  for (const partner of partnersResult.data ?? []) {
    summaryMap.set(summaryKey('partner', partner.id), {
      id:                      partner.id,
      source:                  'partner',
      full_name:               partner.full_name,
      total_contributed_paisa: 0,
      total_withdrawn_paisa:   0,
      net_capital_paisa:       0,
    })
  }

  for (const tx of transactionsResult.data ?? []) {
    const key = tx.partner_id
      ? summaryKey('profile', tx.partner_id)
      : tx.partner_profile_id
        ? summaryKey('partner', tx.partner_profile_id)
        : null

    if (!key) continue

    const fullName =
      tx.partner?.full_name ??
      tx.simple_partner?.full_name ??
      'Unknown'

    const existing = summaryMap.get(key) ?? {
      id:                      tx.partner_id ?? tx.partner_profile_id,
      source:                  tx.partner_id ? 'profile' as const : 'partner' as const,
      full_name:               fullName,
      total_contributed_paisa: 0,
      total_withdrawn_paisa:   0,
      net_capital_paisa:       0,
    }

    if (tx.type === 'contribution') {
      existing.total_contributed_paisa += tx.amount_paisa
    } else if (tx.type === 'withdrawal') {
      existing.total_withdrawn_paisa += tx.amount_paisa
    }

    existing.net_capital_paisa =
      existing.total_contributed_paisa - existing.total_withdrawn_paisa
    summaryMap.set(key, existing)
  }

  const summaries = [...summaryMap.values()].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  )

  const totalCapital = summaries.reduce(
    (s, p) => s + p.net_capital_paisa,
    0,
  )

  return NextResponse.json({
    summaries,
    transactions: transactionsResult.data ?? [],
    totalCapital,
  })
}

export async function POST(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const body = await request.json()

  const {
    partner_id,
    partner_profile_id,
    type,
    amount_paisa,
    transaction_date,
    reference,
    notes,
  } = body

  if (!partner_id && !partner_profile_id) {
    return NextResponse.json(
      { error: 'Partner is required' },
      { status: 400 },
    )
  }
  if (partner_id && partner_profile_id) {
    return NextResponse.json(
      { error: 'Provide either partner_id or partner_profile_id, not both' },
      { status: 400 },
    )
  }
  if (!type || !['contribution', 'withdrawal'].includes(type)) {
    return NextResponse.json(
      { error: 'Type must be contribution or withdrawal' },
      { status: 400 },
    )
  }
  if (!amount_paisa || amount_paisa <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0' },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('capital_transactions')
    .insert({
      tenant_id:          writeTenantId,
      partner_id:         partner_id         || null,
      partner_profile_id: partner_profile_id || null,
      type,
      amount_paisa,
      transaction_date: transaction_date || new Date().toISOString().split('T')[0],
      reference:        reference        || null,
      notes:            notes            || null,
      created_by:       user?.id         || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
