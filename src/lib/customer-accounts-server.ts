import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeApi, type ApiAuthResult } from '@/lib/tenant-api'

// Enable only during the coordinated app/database release. There is deliberately
// no fallback to legacy financial writes if the activated gateway is unavailable.
export function customerAccountsEnabled(): boolean {
  return process.env.CUSTOMER_ACCOUNTS_V1_ENABLED === 'true'
}

export async function callCustomerAccount(
  auth: ApiAuthResult, action: string, customerId: string | null, payload: Record<string, unknown> = {},
) {
  const { data, error } = await createAdminClient().rpc('customer_account_action_v1', {
    p_actor: auth.ctx.userId, p_tenant: auth.tenantId, p_action: action,
    p_customer: customerId, p_payload: payload,
  })
  if (error) throw error
  return data
}

const fields = [
  'request_id', 'expected_updated_at', 'balance_type', 'amount_paisa', 'entry_date', 'notes',
  'payment_date', 'payment_method', 'bank_account_id', 'reference', 'allocation_mode', 'sale_id',
  'amount_received_paisa', 'advance_paisa', 'sale_date', 'due_date', 'items',
  'discount_type', 'discount_value', 'paid_by', 'paid_by_partner_id', 'paid_by_partner_source',
] as const

export async function customerAccountResponse(request: Request, action: string, id?: string) {
  const auth = await authorizeApi(request, { permission: ['sale','create_sale','edit_sale'].includes(action) ? 'sales' : 'customers' })
  if (auth instanceof NextResponse) return auth
  if (!customerAccountsEnabled()) return NextResponse.json({ error: 'Customer accounts are not enabled yet' }, { status: 503 })
  try {
    let customerId = id ?? null
    let payload: Record<string, unknown> = {}
    if (request.method !== 'GET') {
      const body = await request.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
      payload = Object.fromEntries(fields.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]))
      if (['receipt','create_sale'].includes(action)) customerId = body.customer_id
      if (action === 'edit_sale' && ['payment_status','amount_paid_paisa','payment_method','bank_account_id'].some(key => Object.hasOwn(body,key))) {
        return NextResponse.json({ error: 'Record payments from the customer profile' }, { status: 400 })
      }
      if (action === 'edit_sale') {
        const existing = await callCustomerAccount(auth, 'sale', null, { sale_id: id })
        if (body.customer_id && body.customer_id !== existing.customer_id) return NextResponse.json({ error: 'Create a new sale to use a different customer' }, { status: 409 })
        customerId = existing.customer_id
        payload.sale_id = id
      }
    }
    if (action === 'sale') payload = { sale_id: id }
    if (action === 'summary') payload.module = new URL(request.url).searchParams.get('module') === 'sales' ? 'sales' : 'customers'
    const data = await callCustomerAccount(auth, action, customerId, payload)
    if (action === 'sale' || action === 'edit_sale' || action === 'create_sale') {
      data.cogs_paisa = (data.items ?? []).reduce((sum: number, item: { quantity_trays: number; cost_per_tray_paisa: number }) => sum + item.quantity_trays * item.cost_per_tray_paisa, 0)
    }
    return NextResponse.json(data, { status: ['opening','receipt','advance','create_sale'].includes(action) ? 201 : 200 })
  } catch (error) {
    const err = error as { code?: string; message?: string }
    const status = err.code === '42501' ? 403 : err.code === 'P0002' ? 404
      : ['P0001','23514'].includes(err.code ?? '') ? 409
        : ['22023','22P02','22003','22007','22008','23502'].includes(err.code ?? '') || error instanceof SyntaxError ? 400 : 503
    return NextResponse.json({ error: status === 503 ? 'Unable to confirm this save. Retry with the same details to avoid a duplicate.' : err.message ?? 'Invalid request' }, { status })
  }
}
