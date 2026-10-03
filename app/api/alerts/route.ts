import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorized } from '@/lib/api-auth'
import { getAlerts } from '@/app/actions/alerts'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = rejectUnauthorized(request)
  if (denied) return denied

  const result = await getAlerts()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json(result.data)
}