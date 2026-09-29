export const ownerPermissions = {
  canViewDashboard:  true,
  canViewCustomers:  true,
  canViewSuppliers:  true,
  canViewSales:      true,
  canViewPurchases:  true,
  canManageStock:    true,
  canViewExpenses:   true,
  canViewAccounts:   true,
  canViewCashBook:   true,
  canViewReports:    true,
  canViewCapital:    true,
  canViewAlerts:     true,
  canViewSettings:   true,
  canDeleteRecords:  true,
} as const

export type Permissions = {
  readonly [K in keyof typeof ownerPermissions]: boolean
}

export const modulePermissionKeys = {
  dashboard: 'canViewDashboard',
  customers: 'canViewCustomers',
  suppliers: 'canViewSuppliers',
  sales: 'canViewSales',
  purchases: 'canViewPurchases',
  stock: 'canManageStock',
  expenses: 'canViewExpenses',
  accounts: 'canViewAccounts',
  cashBook: 'canViewCashBook',
  reports: 'canViewReports',
  capital: 'canViewCapital',
} as const satisfies Record<string, keyof Permissions>

export type ModulePermission = keyof typeof modulePermissionKeys
export type ModulePermissionKey = typeof modulePermissionKeys[ModulePermission]
export type ModulePermissionOverrides = Partial<Record<ModulePermissionKey, boolean>>

const staffPermissions: Permissions = {
  canViewDashboard:  true,
  canViewCustomers:  true,
  canViewSuppliers:  true,
  canViewSales:      true,
  canViewPurchases:  true,
  canManageStock:    true,
  canViewExpenses:   true,
  canViewAccounts:   false,
  canViewCashBook:   true,
  canViewReports:    false,
  canViewCapital:    false,
  canViewAlerts:     true,
  canViewSettings:   false,
  canDeleteRecords:  false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// Accept module names in stored JSON and legacy canView*/canManageStock keys.
// The latter remain the canonical resolved keys used by existing pages.
export function storedModuleOverrides(value: unknown): ModulePermissionOverrides {
  if (!isRecord(value)) return {}

  const overrides: ModulePermissionOverrides = {}
  for (const moduleName of Object.keys(modulePermissionKeys) as ModulePermission[]) {
    const key = modulePermissionKeys[moduleName]
    const storedKey = Object.hasOwn(value, key) ? key : moduleName
    if (!Object.hasOwn(value, storedKey)) continue

    const storedValue = value[storedKey]
    // A malformed value for a recognized key denies rather than becoming truthy.
    overrides[key] = typeof storedValue === 'boolean' ? storedValue : false
  }
  return overrides
}

export function validateModuleOverrides(
  value: unknown,
): ModulePermissionOverrides | null {
  if (!isRecord(value)) return null

  const overrides: ModulePermissionOverrides = {}
  const canonicalKeys = new Set<string>(Object.values(modulePermissionKeys))
  for (const [inputKey, inputValue] of Object.entries(value)) {
    const key = Object.hasOwn(modulePermissionKeys, inputKey)
      ? modulePermissionKeys[inputKey as ModulePermission]
      : canonicalKeys.has(inputKey)
        ? inputKey as ModulePermissionKey
        : null

    if (!key || typeof inputValue !== 'boolean' || Object.hasOwn(overrides, key)) {
      return null
    }
    overrides[key] = inputValue
  }
  return overrides
}

export function getDefaultPermissions(role: string): Permissions {
  if (role === 'super_admin' || role === 'owner') {
    return { ...ownerPermissions }
  }
  return { ...staffPermissions }
}

export function resolvePermissions(role: string, storedPermissions: unknown): Permissions {
  const defaults = getDefaultPermissions(role)
  if (role !== 'staff') return defaults
  return { ...defaults, ...storedModuleOverrides(storedPermissions) }
}

export function hasModulePermission(
  permissions: Permissions,
  moduleName: ModulePermission,
): boolean {
  return permissions[modulePermissionKeys[moduleName]]
}

export type PermissionKey = keyof Permissions

export function navPermissionForHref(href: string): PermissionKey | null {
  switch (href) {
    case '/capital':   return 'canViewCapital'
    case '/reports':   return 'canViewReports'
    case '/accounts':  return 'canViewAccounts'
    case '/cash-book': return 'canViewCashBook'
    default:           return null
  }
}
