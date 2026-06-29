export const ownerPermissions = {
  canViewCapital:    true,
  canViewReports:    true,
  canViewAccounts:   true,
  canViewSettings:   true,
  canDeleteRecords:  true,
  canManageStock:    true,
  canViewCashBook:   true,
  canViewAlerts:     true,
} as const

export type Permissions = {
  readonly [K in keyof typeof ownerPermissions]: boolean
}

const staffPermissions: Permissions = {
  canViewCapital:    false,
  canViewReports:    false,
  canViewAccounts:   false,
  canViewSettings:   false,
  canDeleteRecords:  false,
  canManageStock:    true,
  canViewCashBook:   true,
  canViewAlerts:     true,
}

export function getDefaultPermissions(role: string): Permissions {
  if (role === 'super_admin' || role === 'owner') {
    return { ...ownerPermissions }
  }
  return { ...staffPermissions }
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
