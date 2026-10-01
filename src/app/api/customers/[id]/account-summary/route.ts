import { NextResponse } from 'next/server'
import { authorizeApi } from '@/lib/tenant-api'
import { callCustomerAccount, customerAccountsEnabled } from '@/lib/customer-accounts-server'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const permissionModule = new URL(request.url).searchParams.get('module') === 'sales' ? 'sales' : 'customers'
  const auth = await authorizeApi(request, { permission: permissionModule })
  if (auth instanceof NextResponse) return auth
  if (!customerAccountsEnabled()) return NextResponse.json({ accounts_enabled: false })
  try {
    return NextResponse.json(await callCustomerAccount(auth, 'summary', (await params).id, { module: permissionModule }))
  } catch {
    return NextResponse.json({ error: 'Unable to load the latest customer balance' }, { status: 503 })
  }
}
