import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq, requireWriteTenantId } from '@/lib/tenant-api'
import { enrichExpensesWithPartnerNames } from '@/lib/expense-partners'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultPermissions } from '@/lib/permissions'

const EXPENSE_SELECT = `
  *,
  category:expense_categories(id, name, icon)
`

function capitalSyncFailure(
  phase: string,
  tenantId: string,
  expenseId: string,
  error: unknown,
) {
  console.error(`Expense capital ${phase} failed`, {
    tenant_id: tenantId,
    expense_id: expenseId,
    error,
  })
  return NextResponse.json(
    {
      error: `Expense saved but capital ${phase} failed; manual reconciliation is required`,
      expense_id: expenseId,
      capital_sync_failed: true,
    },
    { status: 500 },
  )
}

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
    const status = fetchError && fetchError.code !== 'PGRST116' ? 500 : 404
    return NextResponse.json(
      { error: status === 404 ? 'Expense not found' : fetchError?.message },
      { status },
    )
  }

  const stableReference = `expense:${id}`
  const admin = createAdminClient()
  const { data: linkedCapital, error: capitalLookupError } = await admin
    .from('capital_transactions')
    .select('id, type')
    .eq('tenant_id', writeTenantId)
    .eq('reference', stableReference)
    .limit(2)

  if (capitalLookupError) {
    console.error('Expense capital lookup failed', {
      tenant_id: writeTenantId,
      expense_id: id,
      error: capitalLookupError,
    })
    return NextResponse.json({ error: 'Could not verify expense capital link' }, { status: 500 })
  }
  if ((linkedCapital?.length ?? 0) > 1) {
    return NextResponse.json(
      { error: 'Multiple capital records are linked to this expense. Reconciliation is required.' },
      { status: 409 },
    )
  }
  if (linkedCapital?.length === 1 && linkedCapital[0].type !== 'contribution') {
    return NextResponse.json(
      { error: 'The linked capital record is not a contribution. Reconciliation is required.' },
      { status: 409 },
    )
  }
  if (existing.paid_by === 'partner' && !linkedCapital?.length) {
    return NextResponse.json(
      { error: 'This partner-paid expense has legacy capital data that must be reconciled before editing.' },
      { status: 409 },
    )
  }
  if (existing.paid_by !== 'partner' && linkedCapital?.length) {
    return NextResponse.json(
      { error: 'This business-paid expense still has linked capital data. Reconciliation is required.' },
      { status: 409 },
    )
  }

  const finalPaidBy = paid_by === undefined
    ? existing.paid_by ?? 'business'
    : paid_by === 'partner' ? 'partner' : 'business'
  const finalPartnerId = paid_by_partner_id === undefined
    ? existing.paid_by_partner_id
    : paid_by_partner_id
  const finalPartnerSource = paid_by_partner_source === undefined
    ? existing.paid_by_partner_source ?? 'profile'
    : paid_by_partner_source
  const payerChanged = finalPaidBy !== existing.paid_by ||
    finalPartnerId !== existing.paid_by_partner_id ||
    finalPartnerSource !== existing.paid_by_partner_source

  if (finalPaidBy === 'partner') {
    if (!finalPartnerId) {
      return NextResponse.json(
        { error: 'Partner is required when paid by partner' },
        { status: 400 },
      )
    }
    if (finalPartnerSource !== 'profile' && finalPartnerSource !== 'partner') {
      return NextResponse.json({ error: 'Invalid partner source' }, { status: 400 })
    }

    if (finalPartnerSource === 'partner') {
      let partnerQuery = supabase
        .from('partners')
        .select('id')
        .eq('id', finalPartnerId)
        .eq('tenant_id', writeTenantId)
      if (payerChanged) partnerQuery = partnerQuery.eq('is_active', true)
      const { data: partner, error: partnerError } = await partnerQuery.maybeSingle()

      if (partnerError) {
        return NextResponse.json({ error: partnerError.message }, { status: 500 })
      }
      if (!partner) {
        return NextResponse.json({ error: 'Partner is not eligible for this tenant' }, { status: 400 })
      }
    } else {
      const [profileResult, tenantResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, role')
          .eq('id', finalPartnerId)
          .eq('tenant_id', writeTenantId)
          .maybeSingle(),
        supabase
          .from('tenants')
          .select('owner_id')
          .eq('id', writeTenantId)
          .maybeSingle(),
      ])

      if (profileResult.error || tenantResult.error) {
        return NextResponse.json(
          { error: (profileResult.error ?? tenantResult.error)?.message },
          { status: 500 },
        )
      }
      const profile = profileResult.data
      if (!profile || (payerChanged && profile.role !== 'partner' && profile.id !== tenantResult.data?.owner_id)) {
        return NextResponse.json({ error: 'Partner is not eligible for this tenant' }, { status: 400 })
      }
    }
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

  if (paid_by !== undefined) updates.paid_by = finalPaidBy
  if (finalPaidBy === 'partner' && (
    paid_by !== undefined ||
    paid_by_partner_id !== undefined ||
    paid_by_partner_source !== undefined
  )) {
    updates.paid_by_partner_id     = finalPartnerId
    updates.paid_by_partner_source = finalPartnerSource
  } else if (paid_by !== undefined) {
    updates.paid_by_partner_id     = null
    updates.paid_by_partner_source = null
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

  if (finalPaidBy === 'partner') {
    const capitalFields: Record<string, unknown> = {
      amount_paisa:     data.amount_paisa,
      transaction_date: data.expense_date,
      notes:            `Paid expense: ${data.description.trim()}`,
      updated_at:       new Date().toISOString(),
    }

    if (finalPartnerSource === 'partner') {
      capitalFields.partner_id         = null
      capitalFields.partner_profile_id = finalPartnerId
    } else {
      capitalFields.partner_id         = finalPartnerId
      capitalFields.partner_profile_id = null
    }

    if (linkedCapital?.length) {
      const { data: updatedCapital, error: capitalError } = await admin
        .from('capital_transactions')
        .update(capitalFields)
        .eq('id', linkedCapital[0].id)
        .eq('tenant_id', writeTenantId)
        .eq('reference', stableReference)
        .select('id')

      if (capitalError || updatedCapital?.length !== 1) {
        return capitalSyncFailure('update', writeTenantId, id, capitalError ?? 'Expected one updated row')
      }
    } else {
      const { error: capitalError } = await admin
        .from('capital_transactions')
        .insert({
          tenant_id:  writeTenantId,
          type:       'contribution',
          reference:  stableReference,
          created_by: user?.id || null,
          ...capitalFields,
        })

      if (capitalError) {
        return capitalSyncFailure('insert', writeTenantId, id, capitalError)
      }
    }
  } else if (linkedCapital?.length) {
    const { data: deletedCapital, error: capitalError } = await admin
      .from('capital_transactions')
      .delete()
      .eq('id', linkedCapital[0].id)
      .eq('tenant_id', writeTenantId)
      .eq('reference', stableReference)
      .select('id')

    if (capitalError || deletedCapital?.length !== 1) {
      return capitalSyncFailure('delete', writeTenantId, id, capitalError ?? 'Expected one deleted row')
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

  if (!getDefaultPermissions(auth.ctx.isSuperAdmin ? 'super_admin' : auth.ctx.role ?? 'staff').canDeleteRecords) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: existing, error: fetchError } = await supabase
    .from('expenses')
    .select('id, paid_by')
    .eq('id', id)
    .eq('tenant_id', writeTenantId)
    .single()

  if (fetchError || !existing) {
    const status = fetchError && fetchError.code !== 'PGRST116' ? 500 : 404
    return NextResponse.json(
      { error: status === 404 ? 'Expense not found' : fetchError?.message },
      { status },
    )
  }

  const stableReference = `expense:${id}`
  const admin = createAdminClient()
  const { data: linkedCapital, error: capitalLookupError } = await admin
    .from('capital_transactions')
    .select('id, type')
    .eq('tenant_id', writeTenantId)
    .eq('reference', stableReference)
    .limit(2)

  if (capitalLookupError) {
    console.error('Expense capital lookup failed before deletion', {
      tenant_id: writeTenantId,
      expense_id: id,
      error: capitalLookupError,
    })
    return NextResponse.json({ error: 'Could not verify expense capital link' }, { status: 500 })
  }
  if ((linkedCapital?.length ?? 0) > 1) {
    return NextResponse.json(
      { error: 'Multiple capital records are linked to this expense. Reconciliation is required.' },
      { status: 409 },
    )
  }
  if (linkedCapital?.length === 1 && linkedCapital[0].type !== 'contribution') {
    return NextResponse.json(
      { error: 'The linked capital record is not a contribution. Reconciliation is required.' },
      { status: 409 },
    )
  }
  if (existing.paid_by === 'partner' && !linkedCapital?.length) {
    return NextResponse.json(
      { error: 'This partner-paid expense has legacy capital data that must be reconciled before deleting.' },
      { status: 409 },
    )
  }

  let capitalDeleted = false
  if (linkedCapital?.length) {
    const { data: deletedCapital, error: capitalError } = await admin
      .from('capital_transactions')
      .delete()
      .eq('id', linkedCapital[0].id)
      .eq('tenant_id', writeTenantId)
      .eq('reference', stableReference)
      .select('id')

    if (capitalError || deletedCapital?.length !== 1) {
      console.error('Expense capital deletion failed', {
        tenant_id: writeTenantId,
        expense_id: id,
        capital_id: linkedCapital[0].id,
        error: capitalError ?? 'Expected one deleted row',
      })
      return NextResponse.json(
        { error: 'Capital deletion failed; expense was not deleted', expense_id: id },
        { status: 500 },
      )
    }
    capitalDeleted = true
  }

  const { data: deletedExpense, error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)
    .eq('tenant_id', writeTenantId)
    .select('id')
    .single()

  if (error || !deletedExpense) {
    console.error('Expense deletion failed after capital phase', {
      tenant_id: writeTenantId,
      expense_id: id,
      capital_deleted: capitalDeleted,
      error: error ?? 'Expense delete returned no row',
    })
    return NextResponse.json(
      {
        error: capitalDeleted
          ? 'Capital entry deleted but expense deletion failed; manual reconciliation is required'
          : 'Expense deletion failed',
        expense_id: id,
        partial_failure: capitalDeleted,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
