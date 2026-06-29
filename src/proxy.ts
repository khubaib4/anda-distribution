import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function isSuperAdminUser(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('super_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isLoginPage  = request.nextUrl.pathname.startsWith('/login')
  const isInvitePage = request.nextUrl.pathname.startsWith('/invite')
  const isInviteApi  = request.nextUrl.pathname.startsWith('/api/invite/')
  const isSetupApi   = request.nextUrl.pathname === '/api/admin/setup'
  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin')

  // Not logged in and not on a public page → redirect to login
  if (!user && !isLoginPage && !isInvitePage && !isInviteApi && !isSetupApi) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Logged in and on login page → redirect to dashboard or admin
  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = await isSuperAdminUser(user.id) ? '/admin' : '/'
    return NextResponse.redirect(url)
  }

  // Super admin route guard
  if (user && isAdminRoute) {
    if (!(await isSuperAdminUser(user.id))) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
