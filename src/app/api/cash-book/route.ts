import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)

  const today = new Date().toISOString().split('T')[0]
  const date  = searchParams.get('date') || today

  const [
    { data: salesData,         error: salesError         },
    { data: customerPayments,  error: customerPayError   },
    { data: expensesData,      error: expensesError      },
    { data: supplierPayments,  error: supplierPayError   },
  ] = await Promise.all([
    supabase
      .from('sales')
      .select(`
        id,
        invoice_number,
        sale_date,
        payment_status,
        customer:customers(id, contact_name, business_name),
        items:sale_items(quantity_trays, price_per_tray_paisa)
      `)
      .eq('sale_date', date)
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: true }),

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
  ])

  if (salesError) {
    return NextResponse.json({ error: salesError.message }, { status: 500 })
  }
  if (customerPayError) {
    return NextResponse.json({ error: customerPayError.message }, { status: 500 })
  }
  if (expensesError) {
    return NextResponse.json({ error: expensesError.message }, { status: 500 })
  }
  if (supplierPayError) {
    return NextResponse.json({ error: supplierPayError.message }, { status: 500 })
  }

  const sales = (salesData ?? []).map(sale => {
    const customer = Array.isArray(sale.customer)
      ? sale.customer[0]
      : sale.customer
    const total_paisa = (sale.items ?? []).reduce(
      (sum: number, item: {
        quantity_trays: number
        price_per_tray_paisa: number
      }) => sum + item.quantity_trays * item.price_per_tray_paisa,
      0
    )
    return {
      id:             sale.id,
      invoice_number: sale.invoice_number,
      customer_name:  customer?.contact_name ?? '—',
      business_name:  customer?.business_name ?? null,
      total_paisa,
    }
  })

  const customer_payments = (customerPayments ?? []).map(p => {
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

  const salesTotal = sales.reduce((s, r) => s + r.total_paisa, 0)
  const customerPaymentsTotal = customer_payments.reduce(
    (s, r) => s + r.amount_paisa, 0
  )
  const expensesTotal = expenses.reduce((s, r) => s + r.amount_paisa, 0)
  const supplierPaymentsTotal = supplier_payments.reduce(
    (s, r) => s + r.amount_paisa, 0
  )

  const cashInTotal  = salesTotal + customerPaymentsTotal
  const cashOutTotal = expensesTotal + supplierPaymentsTotal

  return NextResponse.json({
    date,
    cash_in: {
      sales,
      customer_payments,
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
