'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { useTenant } from '@/lib/tenant-client'
import { scopeTenantNavigationHref } from '@/lib/tenant-navigation'

type TenantLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & {
  href: string
}

export default function TenantLink({ href, ...props }: TenantLinkProps) {
  const scope = useTenant()

  return <Link {...props} href={scopeTenantNavigationHref(href, scope)} />
}
