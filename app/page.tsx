import { Metadata } from 'next'
import Link from 'next/link'
import { Activity, Bell, Eye, Plug } from 'lucide-react'
import { DashboardHeader } from '@/components/dashboard-header'
import { getAlertStatistics, getRecentTriggers } from '@/app/actions/analytics'
import { getWatchlists } from '@/app/actions/watchlists'

export const metadata: Metadata = {
  title: 'Crypto Sentinel — Dashboard',
  description: 'Self-hosted cryptocurrency price and indicator alerting',
}

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [{ data: stats }, { data: watchlists }, { data: triggers }] =
    await Promise.all([getAlertStatistics(), getWatchlists(), getRecentTriggers()])

  const symbolsTracked = new Set(
    (watchlists ?? []).flatMap((list) => list.symbols ?? []).filter(Boolean),
  ).size

  const cards = [
    {
      label: 'Active alerts',
      value: stats?.activeAlerts ?? 0,
      hint: `${stats?.totalAlerts ?? 0} total`,
      icon: Bell,
      accent: 'text-purple-400 bg-purple-500/20',
    },
    {
      label: 'Watchlists',
      value: watchlists?.length ?? 0,
      hint: `${symbolsTracked} symbols tracked`,
      icon: Eye,
      accent: 'text-blue-400 bg-blue-500/20',
    },
    {
      label: 'Triggers (24h)',
      value: stats?.triggeredLast24h ?? 0,
      hint: `${stats?.totalTriggered ?? 0} all time`,
      icon: Activity,
      accent: 'text-green-400 bg-green-500/20',
    },
    {
      label: 'API status',
      value: null,
      hint: 'Check /api/system/health',
      icon: Plug,
      accent: 'text-orange-400 bg-orange-500/20',
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {cards.map(({ label, value, hint, icon: Icon, accent }) => (
            <div
              key={label}
              className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm font-medium">{label}</p>
                  <p className="text-3xl font-bold text-white mt-2">
                    {value ?? '—'}
                  </p>
                  <p className="text-slate-500 text-xs mt-1">{hint}</p>
                </div>
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${accent}`}>
                  <Icon className="h-6 w-6" aria-hidden />
                </div>
              </div>
            </div>
          ))}
        </div>

        <section className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-white mb-4">Get started</h2>
          <p className="text-slate-300 mb-6">
            Work through these three steps to get alerts firing.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: '1',
                title: 'Add API credentials',
                body: 'Store your Delta Exchange API key. It is encrypted before it touches the database.',
                href: '/settings#api-credentials',
                color: 'text-purple-400',
              },
              {
                step: '2',
                title: 'Create a watchlist',
                body: 'Add the symbols you want to monitor, for example BTCUSD.',
                href: '/watchlists',
                color: 'text-blue-400',
              },
              {
                step: '3',
                title: 'Set an alert',
                body: 'Pick a condition, attach a notification channel, and let the cron pipeline do the rest.',
                href: '/alerts',
                color: 'text-green-400',
              },
            ].map(({ step, title, body, href, color }) => (
              <div key={step} className="bg-slate-900/50 rounded-lg p-6 border border-slate-700">
                <span className={`text-sm font-semibold ${color}`}>Step {step}</span>
                <h3 className="font-semibold text-white mt-2 mb-2">{title}</h3>
                <p className="text-slate-400 text-sm mb-4">{body}</p>
                <Link href={href} className={`${color} hover:underline text-sm font-medium`}>
                  Open →
                </Link>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-white mb-6">Recent activity</h2>

          {!triggers || triggers.length === 0 ? (
            <p className="text-slate-400">
              No triggers recorded yet. Schedule the cron pipeline to start collecting data.
            </p>
          ) : (
            <ul className="divide-y divide-slate-700">
              {triggers.map((trigger) => (
                <li
                  key={trigger.id}
                  className="py-4 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="text-white font-medium">
                      {trigger.alertName ?? 'Deleted alert'}
                    </p>
                    <p className="text-slate-400 text-sm">{trigger.symbol}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-green-400 font-semibold">
                      ${trigger.triggeredValue.toFixed(2)}
                    </p>
                    <p className="text-slate-500 text-xs">
                      {trigger.createdAt?.toLocaleString() ?? '—'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}