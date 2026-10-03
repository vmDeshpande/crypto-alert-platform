'use client'

import { useState, useEffect } from 'react'
import { DashboardHeader } from '@/components/dashboard-header'
import { Button } from '@/components/ui/button'
import { getWatchlists, createWatchlist, deleteWatchlist } from '@/app/actions/watchlists'

interface WatchlistRow {
  id: string
  name: string
  description: string | null
  symbols: string[]
  createdAt: Date
}

export default function WatchlistsPage() {
  const [watchlists, setWatchlists] = useState<WatchlistRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    symbols: '',
  })

  async function loadWatchlists() {
    setIsLoading(true)
    try {
      const result = await getWatchlists()
      if (result.data) {
        setWatchlists(result.data as WatchlistRow[])
      }
    } catch (error) {
      console.error('[crypto-sentinel] Error loading watchlists:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadWatchlists()
  }, [])

  async function handleCreateWatchlist(e: React.FormEvent) {
    e.preventDefault()
    try {
      const symbols = formData.symbols
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      const result = await createWatchlist({
        name: formData.name,
        description: formData.description,
        symbols,
      })

      if (result.data) {
        setFormData({ name: '', description: '', symbols: '' })
        setShowForm(false)
        await loadWatchlists()
      }
    } catch (error) {
      console.error('[crypto-sentinel] Error creating watchlist:', error)
    }
  }

  async function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this watchlist?')) {
      try {
        await deleteWatchlist(id)
        await loadWatchlists()
      } catch (error) {
        console.error('[crypto-sentinel] Error deleting watchlist:', error)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Watchlists</h1>
            <p className="text-slate-400 mt-2">Manage your cryptocurrency watchlists</p>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            Create Watchlist
          </Button>
        </div>

        {showForm && (
          <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6 mb-8">
            <form onSubmit={handleCreateWatchlist} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Top Altcoins"
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Symbols</label>
                <textarea
                  value={formData.symbols}
                  onChange={(e) => setFormData({ ...formData, symbols: e.target.value })}
                  placeholder="Comma-separated symbols (e.g., BTCUSDT, ETHUSDT)"
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  rows={3}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  Create
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowForm(false)}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading...</p>
          </div>
        ) : watchlists.length === 0 ? (
          <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-12 text-center">
            <p className="text-slate-400 mb-4">No watchlists yet</p>
            <p className="text-slate-500 text-sm">Create your first watchlist to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {watchlists.map((watchlist) => (
              <div
                key={watchlist.id}
                className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6"
              >
                <h3 className="text-xl font-semibold text-white mb-2">{watchlist.name}</h3>
                {watchlist.description && (
                  <p className="text-slate-400 text-sm mb-4">{watchlist.description}</p>
                )}

                <div className="mb-4">
                  <p className="text-slate-400 text-sm mb-2">Symbols ({watchlist.symbols.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {watchlist.symbols.map((symbol: string) => (
                      <span
                        key={symbol}
                        className="px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs"
                      >
                        {symbol}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <a
                    href={`/watchlists/${watchlist.id}`}
                    className="px-3 py-2 bg-purple-600/20 text-purple-300 rounded-lg text-sm hover:bg-purple-600/30"
                  >
                    Edit
                  </a>
                  <button
                    onClick={() => handleDelete(watchlist.id)}
                    className="px-3 py-2 bg-red-600/20 text-red-300 rounded-lg text-sm hover:bg-red-600/30"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
