import type { SupabaseClient } from '@supabase/supabase-js'

type ExpenseRow = {
  paid_by?: string | null
  paid_by_partner_id?: string | null
  paid_by_partner_source?: string | null
  paid_by_partner_name?: string | null
}

export async function enrichExpensesWithPartnerNames<T extends ExpenseRow>(
  supabase: SupabaseClient,
  expenses: T[],
): Promise<T[]> {
  const profileIds = expenses
    .filter(e => e.paid_by === 'partner' && e.paid_by_partner_source === 'profile' && e.paid_by_partner_id)
    .map(e => e.paid_by_partner_id as string)

  const partnerIds = expenses
    .filter(e => e.paid_by === 'partner' && e.paid_by_partner_source === 'partner' && e.paid_by_partner_id)
    .map(e => e.paid_by_partner_id as string)

  const [profilesResult, partnersResult] = await Promise.all([
    profileIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', profileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    partnerIds.length > 0
      ? supabase.from('partners').select('id, full_name').in('id', partnerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ])

  const profileMap = new Map(
    (profilesResult.data ?? []).map(p => [p.id, p.full_name]),
  )
  const partnerMap = new Map(
    (partnersResult.data ?? []).map(p => [p.id, p.full_name]),
  )

  return expenses.map(expense => {
    if (expense.paid_by !== 'partner' || !expense.paid_by_partner_id) {
      return expense
    }

    const name = expense.paid_by_partner_source === 'partner'
      ? partnerMap.get(expense.paid_by_partner_id)
      : profileMap.get(expense.paid_by_partner_id)

    return { ...expense, paid_by_partner_name: name ?? null }
  })
}
