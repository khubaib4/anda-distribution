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
  bank_account_id: string | null
  paid_by: 'business' | 'partner'
  paid_by_partner_id: string | null
  paid_by_partner_source: 'profile' | 'partner' | null
  paid_by_partner_name?: string | null
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
  due_date: string | null
  amount_paid_paisa: number
  discount_type: 'percentage' | 'fixed' | null
  discount_value: number
  discount_amount_paisa: number
  created_by: string | null
  created_at: string
  updated_at: string
  customer?: Customer
  items?: SaleItem[]
  subtotal_paisa?: number
  total_paisa?: number
  paid_paisa?: number
  remaining_paisa?: number
}

export interface SaleItem {
  id: string
  sale_id: string
  egg_category_id: string
  quantity_trays: number
  price_per_tray_paisa: number
  discount_type: 'percentage' | 'fixed' | null
  discount_value: number
  discounted_price_paisa: number
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
  partner_id: string | null
  partner_profile_id: string | null
  type: CapitalTransactionType
  amount_paisa: number
  reference: string | null
  notes: string | null
  transaction_date: string
  created_by: string | null
  created_at: string
  updated_at: string
  partner?: Profile
  simple_partner?: SimplePartner
}

export interface SimplePartner {
  id: string
  tenant_id: string
  full_name: string
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface PartnerOption {
  id: string
  full_name: string
  phone: string | null
  source: 'profile' | 'partner'
}

export interface StockMovement {
  id: string
  egg_category_id: string
  movement_type: MovementType
  quantity_trays: number
  quantity_eggs: number
  reason: string | null
  price_per_egg_paisa: number
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
  quantity_eggs: number
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
  id: string
  source: 'profile' | 'partner'
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

export interface SupplierPayment {
  id:             string
  supplier_id:    string
  amount_paisa:   number
  payment_date:   string
  payment_method: PaymentMethod | null
  reference:      string | null
  notes:          string | null
  created_by:     string | null
  created_at:     string
}

export interface SupplierBalance {
  supplier_id:          string
  name:                 string
  phone:                string | null
  is_active:            boolean
  total_purchases_paisa: number
  total_paid_paisa:     number
  balance_paisa:        number
}

export interface SupplierLedgerEntry {
  id:              string
  entry_type:      'purchase' | 'payment'
  entry_date:      string
  description:     string
  debit_paisa:     number
  credit_paisa:    number
  running_balance: number
  invoice_number?: string
  payment_method?: string
}

export interface BankAccount {
  id:             string
  bank_name:      string
  account_holder: string
  account_number: string | null
  nickname:       string | null
  is_active:      boolean
  created_by:     string | null
  created_at:     string
  updated_at:     string
}

export interface BankAccountBalance {
  bank_account_id:           string
  bank_name:                 string
  account_holder:            string
  account_number:            string | null
  nickname:                  string | null
  is_active:                 boolean
  total_received_paisa:      number
  total_supplier_paid_paisa: number
  total_expenses_paisa:      number
  balance_paisa:             number
}

export interface OverdueSale {
  sale_id:         string
  invoice_number:  string | null
  sale_date:       string
  due_date:        string
  days_overdue:    number
  payment_status:  PaymentStatus
  customer_id:     string
  contact_name:    string
  business_name:   string | null
  phone:           string | null
  balance_paisa:   number
}
