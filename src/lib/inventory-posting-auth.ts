import 'server-only'
import { NextResponse } from 'next/server'
import { authorizeApi, type ApiAuthResult } from '@/lib/tenant-api'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ModulePermission } from '@/lib/permissions'

export type InventoryOperation =
  | 'sale' | 'purchase' | 'opening_stock' | 'adjustment_in' | 'adjustment_out'
export type InventoryAction = 'create' | 'update' | 'delete'

const operationModules = {
  sale: 'sales',
  purchase: 'purchases',
  opening_stock: 'stock',
  adjustment_in: 'stock',
  adjustment_out: 'stock',
} as const satisfies Record<InventoryOperation, ModulePermission>

// Future posting preflight only; existing routes do not call this helper.
// Success grants no write capability. Future transactional posting must repeat
// the database assertion inside the transaction before changing any records.
export async function authorizeInventoryPosting(
  request: Request,
  operation: InventoryOperation,
  action: InventoryAction,
): Promise<ApiAuthResult | NextResponse> {
  if (!Object.hasOwn(operationModules, operation)
      || !['create', 'update', 'delete'].includes(action)
      || (operation !== 'sale' && operation !== 'purchase' && action !== 'create')) {
    return NextResponse.json({ error: 'Invalid inventory operation' }, { status: 400 })
  }

  // Uses verified session identity and existing explicit super-admin selection.
  // Ordinary members always use their membership tenant, ignoring URL overrides.
  const auth = await authorizeApi(request, { permission: operationModules[operation] })
  if (auth instanceof NextResponse) return auth
  if (action === 'delete' && !auth.ctx.permissions.canDeleteRecords) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { data, error } = await createAdminClient().rpc(
      'assert_inventory_posting_permission_de05',
      {
        p_actor_user_id: auth.ctx.userId,
        p_tenant_id: auth.tenantId,
        p_operation: operation,
        p_action: action,
      },
    )
    if (error?.code === '42501') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (error || data !== true) {
      return NextResponse.json({ error: 'Inventory permission check unavailable' }, { status: 503 })
    }
  } catch {
    return NextResponse.json({ error: 'Inventory permission check unavailable' }, { status: 503 })
  }
  return auth
}
