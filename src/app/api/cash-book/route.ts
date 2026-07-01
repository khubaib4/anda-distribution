import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { authorizeApi, tenantEq } from '@/lib/tenant-api'

export async function GET(request: Request) {
  const auth = await authorizeApi(request)
  if (auth instanceof NextResponse) return auth
  const { tenantId } = auth

  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const today = new Date().toISOString().split('T')[0]
  const date  = searchParams.get('date') || today

  const [
    { data: customerPayments,  error: customerPayError   },
    { data: expensesData,      error: expensesError      },
    { data: supplierPayments,  error: supplierPayError   },
  ] = await Promise.all([
    tenantEq(
      supabase
        .from('customer_payments')
        .select(`
          id,
          customer_id,
          amount_paisa,
          payment_date,
          payment_method,
          reference,
          notes,
          customer:customers(contact_name, business_name)
        `)
        .eq('payment_date', date)
        .order('created_at', { ascending: true }),
      tenantId,
    ),
    tenantEq(
      supabase
        .from('expenses')
        .select(`
          id,
          amount_paisa,
          expense_date,
          description,
          category:expense_categories(name, icon)
        `)
        .eq('expense_date', date)
        .order('created_at', { ascending: true }),
      tenantId,
    ),
    tenantEq(
      supabase
        .from('supplier_payments')
        .select(`
          id,
          supplier_id,
          amount_paisa,
          payment_date,
          payment_method,
          reference,
          notes,
          supplier:suppliers(name)
        `)
        .eq('payment_date', date)
        .order('created_at', { ascending: true }),
      tenantId,
    ),
  ])

  if (customerPayError) {
    return NextResponse.json({ error: customerPayError.message }, { status: 500 })
  }
  if (expensesError) {
    return NextResponse.json({ error: expensesError.message }, { status: 500 })
  }
  if (supplierPayError) {
    return NextResponse.json({ error: supplierPayError.message }, { status: 500 })
  }

  const payments = (customerPayments ?? []).map(p => {
    const customer = Array.isArray(p.customer) ? p.customer[0] : p.customer
    return {
      id:             p.id,
      customer_id:    p.customer_id,
      customer_name:  customer?.contact_name ?? '—',
      amount_paisa:   p.amount_paisa,
      payment_method: p.payment_method,
      reference:      p.reference,
      notes:          p.notes,
    }
  })

  const expenses = (expensesData ?? []).map(e => {
    const category = Array.isArray(e.category) ? e.category[0] : e.category
    return {
      id:           e.id,
      description:  e.description,
      category:     category?.name ?? 'Other',
      icon:         category?.icon ?? '📋',
      amount_paisa: e.amount_paisa,
    }
  })

  const supplier_payments = (supplierPayments ?? []).map(p => {
    const supplier = Array.isArray(p.supplier) ? p.supplier[0] : p.supplier
    return {
      id:             p.id,
      supplier_id:    p.supplier_id,
      supplier_name:  supplier?.name ?? '—',
      amount_paisa:   p.amount_paisa,
      payment_method: p.payment_method,
      reference:      p.reference,
      notes:          p.notes,
    }
  })

  const cashInTotal = payments.reduce((s, r) => s + r.amount_paisa, 0)
  const expensesTotal = expenses.reduce((s, r) => s + r.amount_paisa, 0)
  const supplierPaymentsTotal = supplier_payments.reduce(
    (s, r) => s + r.amount_paisa, 0,
  )

  const cashOutTotal = expensesTotal + supplierPaymentsTotal

  return NextResponse.json({
    date,
    cash_in: {
      payments,
      total: cashInTotal,
    },
    cash_out: {
      expenses,
      supplier_payments,
      total: cashOutTotal,
    },
    net: cashInTotal - cashOutTotal,
  })
}
