import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'

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
      .select('id, full_name, phone'),
    tenantId,
  )

  if (tenant?.owner_id) {
    profilesQuery = profilesQuery.or(
      `role.eq.partner,id.eq.${tenant.owner_id}`,
    )
  } else {
    profilesQuery = profilesQuery.eq('role', 'partner')
  }

  const [profilesResult, partnersResult] = await Promise.all([
    profilesQuery.order('full_name'),
    tenantEq(
      supabase
        .from('partners')
        .select('id, full_name, phone')
        .eq('is_active', true),
      tenantId,
    ).order('full_name'),
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

  const unified = [
    ...(profilesResult.data ?? []).map(p => ({
      id:        p.id,
      full_name: p.full_name,
      phone:     p.phone,
      source:    'profile' as const,
    })),
    ...(partnersResult.data ?? []).map(p => ({
      id:        p.id,
      full_name: p.full_name,
      phone:     p.phone,
      source:    'partner' as const,
    })),
  ].sort((a, b) => a.full_name.localeCompare(b.full_name))

  return NextResponse.json(unified)
}

export async function POST(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

  const supabase = await createClient()
  const body = await request.json()

  const { full_name, phone } = body

  if (!full_name?.trim()) {
    return NextResponse.json(
      { error: 'Full name is required' },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('partners')
    .insert({
      tenant_id: writeTenantId,
      full_name: full_name.trim(),
      phone:     phone?.trim() || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
