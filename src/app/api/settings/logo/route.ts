import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOwnerOnly } from '@/app/api/settings/route'

const MAX_BYTES = 2 * 1024 * 1024

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
}

export async function POST(request: Request) {
  const auth = await requireOwnerOnly(request)
  if (auth instanceof NextResponse) return auth

  const { tenantId } = auth

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('logo')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Logo file is required' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Logo must be 2MB or smaller' },
      { status: 400 },
    )
  }

  const ext = MIME_TO_EXT[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: 'Supported formats: JPG, PNG, WebP' },
      { status: 400 },
    )
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const path = `${tenantId}/logo.${ext}`

  const admin = createAdminClient()

  const { error: uploadError } = await admin.storage
    .from('logos')
    .upload(path, bytes, {
      contentType: file.type,
      upsert:      true,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: publicData } = admin.storage.from('logos').getPublicUrl(path)
  const logoUrl = publicData.publicUrl

  const { error: updateError } = await admin
    .from('tenants')
    .update({
      logo_url:   logoUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenantId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ logo_url: logoUrl })
}
