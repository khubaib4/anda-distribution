export type PaymentStatus = 'paid' | 'partial' | 'unpaid'
export type MovementType =
  | 'purchase_in'
  | 'sale_out'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'opening_stock'
export type CustomerType = 'shop' | 'restaurant' | 'wholesaler' | 'other'
export type LaborType = 'daily' | 'monthly'
export type CapitalTransactionType = 'contribution' | 'withdrawal'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'easypaisa' | 'jazzcash'

export interface Profile {
  id: string
  full_name: string
  role: 'partner' | 'staff'
  phone: string | null
  created_at: string
  updated_at: string
}

export interface EggCategory {
  id: string
  name: string
  display_order: number
  is_active: boolean
  created_at: string
}

export interface Supplier {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Purchase {
  id: string
  supplier_id: string | null
  supplier_name_snapshot: string | null
  purchase_date: string
  invoice_number: string | null
  notes: string | null
  payment_status: PaymentStatus
  amount_paid_paisa: number
  created_by: string | null
  created_at: string
  updated_at: string
  supplier?: Supplier
  items?: PurchaseItem[]
  total_paisa?: number
}

export interface PurchaseItem {
  id: string
  purchase_id: string
  egg_category_id: string
  quantity_trays: number
  price_per_tray_paisa: number
  total_paisa: number
  created_at: string
  egg_category?: EggCategory
}

export interface ExpenseCategory {
  id: string
  name: string
  icon: string | null
  created_at: string
}

export interface Expense {
  id: string
  category_id: string
  amount_paisa: number
  expense_date: string
  description: string
  vehicle: string | null
  odometer_km: number | null
  worker_name: string | null
  labor_type: LaborType | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  category?: ExpenseCategory
}

export interface Customer {
  id: string
  business_name: string | null
  contact_name: string
  phone: string | null
  address: string | null
  area: string | null
  customer_type: CustomerType | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Sale {
  id: string
  customer_id: string
  sale_date: string
  invoice_number: string | null
  notes: string | null
  payment_status: PaymentStatus
  created_by: string | null
  created_at: string
  updated_at: string
  customer?: Customer
  items?: SaleItem[]
  total_paisa?: number
}

export interface SaleItem {
  id: string
  sale_id: string
  egg_category_id: string
  quantity_trays: number
  price_per_tray_paisa: number
  cost_per_tray_paisa: number
  total_paisa: number
  created_at: string
  egg_category?: EggCategory
}

export interface CustomerPayment {
  id: string
  customer_id: string
  amount_paisa: number
  payment_date: string
  payment_method: PaymentMethod | null
  reference: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface CapitalTransaction {
  id: string
  partner_id: string
  type: CapitalTransactionType
  amount_paisa: number
  reference: string | null
  notes: string | null
  transaction_date: string
  created_by: string | null
  created_at: string
  updated_at: string
  partner?: Profile
}

export interface StockMovement {
  id: string
  egg_category_id: string
  movement_type: MovementType
  quantity_trays: number
  reference_id: string | null
  notes: string | null
  movement_date: string
  created_by: string | null
  created_at: string
  egg_category?: EggCategory
}

export interface CurrentStock {
  egg_category_id: string
  egg_category: string
  quantity_trays: number
  quantity_peti_approx: number
}

export interface CustomerBalance {
  customer_id: string
  contact_name: string
  business_name: string | null
  phone: string | null
  customer_type: string | null
  is_active: boolean
  total_sales_paisa: number
  total_paid_paisa: number
  balance_paisa: number
}

export interface PartnerCapitalSummary {
  partner_id: string
  full_name: string
  total_contributed_paisa: number
  total_withdrawn_paisa: number
  net_capital_paisa: number
}

export interface LedgerEntry {
  customer_id: string
  entry_type: 'sale' | 'payment'
  entry_date: string
  reference_id: string
  amount_paisa: number
  direction: 'debit' | 'credit'
  invoice_number?: string | null
}
