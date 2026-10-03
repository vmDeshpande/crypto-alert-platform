'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { logout } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/watchlists', label: 'Watchlists' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
]

export function DashboardHeader() {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function handleLogout() {
    setIsLoading(true)
    try {
      await logout()
      router.push('/login')
      router.refresh()
    } catch (error) {
      console.error('[crypto-sentinel] Logout error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-slate-900/50 backdrop-blur-xl border-b border-purple-500/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600" />
            <h1 className="text-xl font-bold text-white">Crypto Sentinel</h1>
          </div>

          <nav className="hidden md:flex items-center space-x-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/50 transition-colors"
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center space-x-4">
            <Button
              onClick={handleLogout}
              disabled={isLoading}
              variant="outline"
              size="sm"
            >
              {isLoading ? 'Logging out...' : 'Logout'}
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
