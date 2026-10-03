'use client'

import { useState, useEffect } from 'react'
import { DashboardHeader } from '@/components/dashboard-header'
import { Button } from '@/components/ui/button'
import {
  getApiCredentials,
  createApiCredential,
  deleteApiCredential,
  toggleApiCredential,
} from '@/app/actions/api-credentials'

interface CredentialRow {
  id: string
  name: string
  exchange: string
  isActive: boolean
  createdAt: Date
}

export default function SettingsPage() {
  const [credentials, setCredentials] = useState<CredentialRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    apiKey: '',
    apiSecret: '',
  })
  const [error, setError] = useState('')

  async function loadCredentials() {
    setIsLoading(true)
    try {
      const result = await getApiCredentials()
      if (result.data) {
        setCredentials(result.data as CredentialRow[])
      }
    } catch (err) {
      console.error('[crypto-sentinel] Error loading credentials:', err)
      setError('Failed to load credentials')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCredentials()
  }, [])

  async function handleCreateCredential(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    try {
      const result = await createApiCredential({
        name: formData.name,
        apiKey: formData.apiKey,
        apiSecret: formData.apiSecret,
      })

      if (result.error) {
        setError(result.error)
      } else {
        setFormData({ name: '', apiKey: '', apiSecret: '' })
        setShowForm(false)
        await loadCredentials()
      }
    } catch (err) {
      console.error('[crypto-sentinel] Error creating credential:', err)
      setError('Failed to create credential')
    }
  }

  async function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this credential?')) {
      try {
        await deleteApiCredential(id)
        await loadCredentials()
      } catch (error) {
        console.error('[crypto-sentinel] Error deleting credential:', error)
      }
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      await toggleApiCredential(id, !isActive)
      await loadCredentials()
    } catch (error) {
      console.error('[crypto-sentinel] Error toggling credential:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Settings</h1>
          <p className="text-slate-400 mt-2">Configure your API credentials and preferences</p>
        </div>

        {/* API Credentials Section */}
        <div id="api-credentials" className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-8 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-white">API Credentials</h2>
            <Button
              onClick={() => setShowForm(!showForm)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              Add Credential
            </Button>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {showForm && (
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6 mb-6">
              <form onSubmit={handleCreateCredential} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Main Account"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">API Key</label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    placeholder="Your Delta Exchange API key"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">API Secret</label>
                  <input
                    type="password"
                    value={formData.apiSecret}
                    onChange={(e) => setFormData({ ...formData, apiSecret: e.target.value })}
                    placeholder="Your Delta Exchange API secret"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  >
                    Save
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
            <div className="text-center py-8">
              <p className="text-slate-400">Loading...</p>
            </div>
          ) : credentials.length === 0 ? (
            <div className="text-center py-12 bg-slate-900/50 rounded-lg border border-slate-700">
              <p className="text-slate-400">No API credentials configured yet</p>
              <p className="text-slate-500 text-sm mt-2">Add your Delta Exchange credentials to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {credentials.map((cred) => (
                <div key={cred.id} className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-white">{cred.name}</h3>
                    <p className="text-slate-400 text-sm">Delta Exchange</p>
                    <p className="text-slate-500 text-xs mt-2">
                      Created: {new Date(cred.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleToggle(cred.id, cred.isActive)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        cred.isActive
                          ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                          : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {cred.isActive ? 'Active' : 'Inactive'}
                    </button>

                    <button
                      onClick={() => handleDelete(cred.id)}
                      className="px-3 py-2 bg-red-600/20 text-red-300 rounded-lg text-sm hover:bg-red-600/30"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Security Section */}
        <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-white mb-4">Security</h2>

          <div className="space-y-6">
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white mb-1">Password Protection</h3>
                  <p className="text-slate-400 text-sm">
                    {process.env.NEXT_PUBLIC_PASSWORD_PROTECTED
                      ? 'Dashboard is protected with a password'
                      : 'Dashboard is not password protected'}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    process.env.NEXT_PUBLIC_PASSWORD_PROTECTED
                      ? 'bg-green-500/20 text-green-300'
                      : 'bg-yellow-500/20 text-yellow-300'
                  }`}
                >
                  {process.env.NEXT_PUBLIC_PASSWORD_PROTECTED ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white mb-1">Encryption</h3>
                  <p className="text-slate-400 text-sm">
                    API credentials are encrypted using AES-256-GCM
                  </p>
                </div>
                <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">
                  Enabled
                </span>
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white mb-1">Database</h3>
                  <p className="text-slate-400 text-sm">
                    Running on Neon PostgreSQL with automatic backups
                  </p>
                </div>
                <span className="px-3 py-1 bg-green-500/20 text-green-300 rounded-full text-xs font-medium">
                  Secure
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
