import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichExpensesWithPartnerNames } from '@/lib/expense-partners'
import { createAdminClient } from '@/lib/supabase/admin'

const EXPENSE_SELECT = `
  *,
  category:expense_categories(id, name, icon)
`

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await tenantEq(
    supabase
      .from('expenses')
      .select(EXPENSE_SELECT)
      .eq('id', id),
    tenantId,
  ).single()

  if (error) {
    const status = error.code === 'PGRST116' ? 404 : 500
    return NextResponse.json(
      { error: status === 404 ? 'Expense not found' : error.message },
      { status },
    )
  }

  const [enriched] = await enrichExpensesWithPartnerNames(supabase, [data])
  return NextResponse.json(enriched)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const body = await request.json()

  const {
    category_id,
    amount_paisa,
    expense_date,
    description,
    vehicle,
    odometer_km,
    worker_name,
    labor_type,
    notes,
    paid_by,
    paid_by_partner_id,
    paid_by_partner_source,
  } = body

  if (amount_paisa !== undefined && amount_paisa <= 0) {
    return NextResponse.json(
      { error: 'Amount must be greater than 0' },
      { status: 400 },
    )
  }
  if (description !== undefined && !description?.trim()) {
    return NextResponse.json(
      { error: 'Description is required' },
      { status: 400 },
    )
  }

  if (paid_by === 'partner' && !paid_by_partner_id) {
    return NextResponse.json(
      { error: 'Partner is required when paid by partner' },
      { status: 400 },
    )
  }

  const { data: existing, error: fetchError } = await supabase
    .from('expenses')
    .select(`
      description,
      paid_by,
      amount_paisa,
      expense_date,
      paid_by_partner_id,
      paid_by_partner_source
    `)
    .eq('id', id)
    .eq('tenant_id', writeTenantId)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (category_id  !== undefined) updates.category_id  = category_id
  if (amount_paisa !== undefined) updates.amount_paisa = amount_paisa
  if (expense_date !== undefined) updates.expense_date = expense_date
  if (description  !== undefined) updates.description  = description.trim()
  if (vehicle      !== undefined) updates.vehicle      = vehicle      || null
  if (odometer_km  !== undefined) updates.odometer_km = odometer_km  || null
  if (worker_name  !== undefined) updates.worker_name = worker_name  || null
  if (labor_type   !== undefined) updates.labor_type  = labor_type   || null
  if (notes        !== undefined) updates.notes       = notes        || null

  if (paid_by !== undefined) {
    const paidBy = paid_by === 'partner' ? 'partner' : 'business'
    updates.paid_by = paidBy
    if (paidBy === 'partner') {
      updates.paid_by_partner_id     = paid_by_partner_id
      updates.paid_by_partner_source = paid_by_partner_source
    } else {
      updates.paid_by_partner_id     = null
      updates.paid_by_partner_source = null
    }
  }

  const { data, error } = await supabase
    .from('expenses')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', writeTenantId)
    .select(EXPENSE_SELECT)
    .single()

  if (error) {
    const status = error.code === 'PGRST116' ? 404 : 500
    return NextResponse.json(
      { error: status === 404 ? 'Expense not found' : error.message },
      { status },
    )
  }

  const admin = createAdminClient()
  const oldCapitalNotes = `Paid expense: ${existing.description.trim()}`
  const newCapitalNotes = `Paid expense: ${data.description.trim()}`
  const finalPaidBy = data.paid_by ?? 'business'

  if (finalPaidBy !== 'partner') {
    await admin
      .from('capital_transactions')
      .delete()
      .eq('tenant_id', writeTenantId)
      .eq('notes', oldCapitalNotes)

    if (oldCapitalNotes !== newCapitalNotes) {
      await admin
        .from('capital_transactions')
        .delete()
        .eq('tenant_id', writeTenantId)
        .eq('notes', newCapitalNotes)
    }
  } else if (data.paid_by_partner_id) {
    const partnerSource = data.paid_by_partner_source
    const capitalFields: Record<string, unknown> = {
      amount_paisa:     data.amount_paisa,
      transaction_date: data.expense_date,
      notes:            newCapitalNotes,
      updated_at:       new Date().toISOString(),
    }

    if (partnerSource === 'partner') {
      capitalFields.partner_id         = null
      capitalFields.partner_profile_id = data.paid_by_partner_id
    } else {
      capitalFields.partner_id         = data.paid_by_partner_id
      capitalFields.partner_profile_id = null
    }

    const { data: existingCapital } = await admin
      .from('capital_transactions')
      .select('id')
      .eq('tenant_id', writeTenantId)
      .eq('notes', oldCapitalNotes)
      .maybeSingle()

    if (existingCapital) {
      const { error: capitalError } = await admin
        .from('capital_transactions')
        .update(capitalFields)
        .eq('id', existingCapital.id)

      if (capitalError) {
        return NextResponse.json(
          { error: `Expense saved but capital update failed: ${capitalError.message}` },
          { status: 500 },
        )
      }
    } else {
      const { error: capitalError } = await admin
        .from('capital_transactions')
        .insert({
          tenant_id:  writeTenantId,
          type:       'contribution',
          reference:  null,
          created_by: user?.id || null,
          ...capitalFields,
        })

      if (capitalError) {
        return NextResponse.json(
          { error: `Expense saved but capital entry failed: ${capitalError.message}` },
          { status: 500 },
        )
      }
    }
  }

  const [enriched] = await enrichExpensesWithPartnerNames(supabase, [data])
  return NextResponse.json(enriched)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const writeTenantId = requireWriteTenantId(tenantId, request)
  if (writeTenantId instanceof NextResponse) return writeTenantId

  const { id } = await params
  const supabase = await createClient()

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)
    .eq('tenant_id', writeTenantId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
