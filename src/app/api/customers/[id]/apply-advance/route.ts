import { customerAccountResponse } from '@/lib/customer-accounts-server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return customerAccountResponse(request, 'advance', (await params).id)
}
