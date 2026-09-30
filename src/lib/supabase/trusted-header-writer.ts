import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

type HeaderStatus = 'paid' | 'partial' | 'unpaid'

type StatusUpdate = {
  tenantId: string
  id: string
  relatedId: string
  paymentStatus: HeaderStatus
  amountPaidPaisa: number
}

// This narrow capability keeps FIFO helpers from accepting a session client for
// writes after direct sale and purchase header grants are revoked.
export function createTrustedHeaderWriter() {
  const admin = createAdminClient()

  return {
    async updateSaleStatus({ tenantId, id, relatedId, paymentStatus, amountPaidPaisa }: StatusUpdate) {
      const { data, error } = await admin
        .from('sales')
        .update({
          payment_status: paymentStatus,
          amount_paid_paisa: amountPaidPaisa,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .eq('customer_id', relatedId)
        .select('id')
        .single()
      if (error) throw error
      if (!data || Array.isArray(data) || data.id !== id) {
        throw new Error('Sale status update did not affect exactly one row')
      }
    },

    async updatePurchaseStatus({ tenantId, id, relatedId, paymentStatus, amountPaidPaisa }: StatusUpdate) {
      const { error } = await admin
        .from('purchases')
        .update({
          payment_status: paymentStatus,
          amount_paid_paisa: amountPaidPaisa,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .eq('supplier_id', relatedId)
        .select('id')
        .single()
      if (error) throw error
    },
  }
}

export type TrustedHeaderWriter = ReturnType<typeof createTrustedHeaderWriter>
