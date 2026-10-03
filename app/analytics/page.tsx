'use client'

import { useState, useEffect } from 'react'
import { DashboardHeader } from '@/components/dashboard-header'
import { getAlertStatistics, getPriceStatistics } from '@/app/actions/analytics'

interface AlertStats {
  totalAlerts: number
  activeAlerts: number
  totalTriggered: number
  triggeredLast24h: number
  alertsByCondition: Record<string, number>
  topSymbols: { symbol: string; count: number }[]
}

interface PriceStats {
  symbol: string
  period: string
  priceRange: { high: number; low: number; current: number }
  priceChange: { absolute: number; percent: number }
  volume: { total: number; average: number }
  volatility: number
  dataPoints: number
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<AlertStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')
  const [priceStats, setPriceStats] = useState<PriceStats | null>(null)

  async function loadStatistics() {
    setIsLoading(true)
    try {
      const result = await getAlertStatistics()
      if (result.data) {
        setStats(result.data as AlertStats)
      }
    } catch (error) {
      console.error('[crypto-sentinel] Error loading statistics:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadStatistics()
  }, [])

  async function handleSymbolChange(symbol: string) {
    setSelectedSymbol(symbol)
    if (symbol) {
      const result = await getPriceStatistics(symbol, 24)
      if (result.data) {
        setPriceStats(result.data as PriceStats)
      }
    } else {
      setPriceStats(null)
    }
  }

  const maxConditionCount = stats
    ? Math.max(1, ...Object.values(stats.alertsByCondition))
    : 1

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Analytics</h1>
          <p className="text-slate-400 mt-2">Monitor your alerts and market activity</p>
        </div>

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading analytics...</p>
          </div>
        ) : (
          <>
            {/* Alert Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6">
                <p className="text-slate-400 text-sm font-medium mb-2">Total Alerts</p>
                <p className="text-4xl font-bold text-white">
                  {stats?.totalAlerts || 0}
                </p>
                <p className="text-slate-500 text-xs mt-3">
                  {stats?.activeAlerts || 0} active
                </p>
              </div>

              <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6">
                <p className="text-slate-400 text-sm font-medium mb-2">Triggered (24h)</p>
                <p className="text-4xl font-bold text-orange-400">
                  {stats?.triggeredLast24h || 0}
                </p>
                <p className="text-slate-500 text-xs mt-3">
                  {stats?.totalTriggered || 0} total
                </p>
              </div>

              <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6">
                <p className="text-slate-400 text-sm font-medium mb-2">Top Symbol</p>
                <p className="text-2xl font-bold text-blue-400">
                  {stats?.topSymbols?.[0]?.symbol || '—'}
                </p>
                <p className="text-slate-500 text-xs mt-3">
                  {stats?.topSymbols?.[0]?.count || 0} alerts
                </p>
              </div>

              <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6">
                <p className="text-slate-400 text-sm font-medium mb-2">Alert Types</p>
                <p className="text-2xl font-bold text-green-400">
                  {Object.keys(stats?.alertsByCondition || {}).length}
                </p>
                <p className="text-slate-500 text-xs mt-3">condition types</p>
              </div>
            </div>

            {/* Alert Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4">Alert Conditions</h2>
                <div className="space-y-3">
                  {stats?.alertsByCondition &&
                    Object.entries(stats.alertsByCondition).map(
                      ([condition, count]) => (
                        <div key={condition} className="flex items-center justify-between">
                          <p className="text-slate-300 capitalize">{condition.replace(/_/g, ' ')}</p>
                          <div className="flex items-center gap-2">
                            <div className="w-32 bg-slate-700 rounded-full h-2">
                              <div
                                className="bg-purple-500 h-2 rounded-full"
                                style={{
                                  width: `${(count / maxConditionCount) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="text-white font-medium w-8 text-right">{count}</span>
                          </div>
                        </div>
                      ),
                    )}
                </div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4">Top Symbols</h2>
                <div className="space-y-3">
                  {stats?.topSymbols && stats.topSymbols.length > 0 ? (
                    stats.topSymbols.map((item, index) => (
                      <button
                        key={item.symbol}
                        onClick={() => handleSymbolChange(item.symbol)}
                        className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors ${
                          selectedSymbol === item.symbol
                            ? 'bg-purple-600/30 border border-purple-500 text-white'
                            : 'bg-slate-700/30 hover:bg-slate-700/50 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">#{index + 1}</span>
                          <span className="font-mono font-bold">{item.symbol}</span>
                        </div>
                        <span className="text-sm">{item.count} alerts</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-slate-400 text-sm">No symbols yet</p>
                  )}
                </div>
              </div>
            </div>

            {/* Price Statistics for Selected Symbol */}
            {priceStats && (
              <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-6">
                  {priceStats.symbol} - 24h Statistics
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm mb-1">Current Price</p>
                    <p className="text-2xl font-bold text-white">
                      ${priceStats.priceRange.current.toFixed(2)}
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm mb-1">24h High</p>
                    <p className="text-2xl font-bold text-green-400">
                      ${priceStats.priceRange.high.toFixed(2)}
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm mb-1">24h Low</p>
                    <p className="text-2xl font-bold text-red-400">
                      ${priceStats.priceRange.low.toFixed(2)}
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm mb-1">24h Change</p>
                    <p
                      className={`text-2xl font-bold ${
                        priceStats.priceChange.percent >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                      }`}
                    >
                      {priceStats.priceChange.percent.toFixed(2)}%
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm mb-1">Volatility</p>
                    <p className="text-2xl font-bold text-blue-400">
                      {priceStats.volatility.toFixed(4)}
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                    <p className="text-slate-400 text-sm mb-1">Avg Volume</p>
                    <p className="text-2xl font-bold text-purple-400">
                      {(priceStats.volume.average / 1000000).toFixed(1)}M
                    </p>
                  </div>

                  <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700 col-span-2">
                    <p className="text-slate-400 text-sm mb-1">Data Points</p>
                    <p className="text-2xl font-bold text-slate-300">
                      {priceStats.dataPoints} candles
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
