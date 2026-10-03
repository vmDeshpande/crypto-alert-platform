'use client'

import { useState, useEffect } from 'react'
import { DashboardHeader } from '@/components/dashboard-header'
import { Button } from '@/components/ui/button'
import {
  getNotificationChannels,
  createNotificationChannel,
  deleteNotificationChannel,
  toggleNotificationChannel,
} from '@/app/actions/notifications'

type ChannelType = 'discord' | 'telegram' | 'email' | 'webhook'

interface ChannelForm {
  type: ChannelType
  name: string
  webhookUrl?: string
  botToken?: string
  chatId?: string
  email?: string
  url?: string
}

interface ChannelRow {
  id: string
  channelName: string
  channelType: ChannelType
  isActive: boolean
  createdAt: Date
}

export default function NotificationsSettingsPage() {
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [activeTab, setActiveTab] = useState<ChannelType>('discord')
  const [formData, setFormData] = useState<ChannelForm>({
    type: 'discord',
    name: '',
  })
  const [error, setError] = useState('')

  async function loadChannels() {
    setIsLoading(true)
    try {
      const result = await getNotificationChannels()
      if (result.data) {
        setChannels(result.data as ChannelRow[])
      }
    } catch (err) {
      console.error('[crypto-sentinel] Error loading channels:', err)
      setError('Failed to load notification channels')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadChannels()
  }, [])

  async function handleCreateChannel(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    try {
      const rawConfig: Record<string, string | undefined> = { type: activeTab }

      switch (activeTab) {
        case 'discord':
          rawConfig.webhookUrl = formData.webhookUrl
          break
        case 'telegram':
          rawConfig.botToken = formData.botToken
          rawConfig.chatId = formData.chatId
          break
        case 'email':
          rawConfig.email = formData.email
          break
        case 'webhook':
          rawConfig.url = formData.url
          break
      }

      // Drop empty optional fields so the stored config only holds what the
      // user actually filled in.
      const config = Object.fromEntries(
        Object.entries(rawConfig).filter(([, value]) => Boolean(value)),
      )

      const result = await createNotificationChannel({
        channelType: activeTab,
        channelName: formData.name,
        config,
      })

      if (result.error) {
        setError(result.error)
      } else {
        setFormData({ type: 'discord', name: '' })
        setShowForm(false)
        await loadChannels()
      }
    } catch (err) {
      console.error('[crypto-sentinel] Error creating channel:', err)
      setError('Failed to create notification channel')
    }
  }

  async function handleDelete(id: string) {
    if (confirm('Delete this notification channel?')) {
      try {
        await deleteNotificationChannel(id)
        await loadChannels()
      } catch (error) {
        console.error('[crypto-sentinel] Error deleting channel:', error)
      }
    }
  }

  async function handleToggle(id: string, isActive: boolean) {
    try {
      await toggleNotificationChannel(id, isActive)
      await loadChannels()
    } catch (error) {
      console.error('[crypto-sentinel] Error toggling channel:', error)
    }
  }

  const channelTabs: ChannelType[] = ['discord', 'telegram', 'email', 'webhook']
  const channelIcons: Record<ChannelType, string> = {
    discord: '💜',
    telegram: '📱',
    email: '📧',
    webhook: '🔗',
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Notification Channels</h1>
          <p className="text-slate-400 mt-2">Configure where to send price alerts</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="flex gap-4 mb-8">
          <Button
            onClick={() => setShowForm(!showForm)}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            Add Channel
          </Button>
        </div>

        {showForm && (
          <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-8 mb-8">
            <h2 className="text-xl font-bold text-white mb-6">Add Notification Channel</h2>

            {/* Channel Type Tabs */}
            <div className="flex gap-2 mb-6 border-b border-slate-700">
              {channelTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-3 font-medium transition-colors border-b-2 ${
                    activeTab === tab
                      ? 'border-purple-500 text-purple-400'
                      : 'border-transparent text-slate-400 hover:text-slate-300'
                  }`}
                >
                  {channelIcons[tab]} {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Channel Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., My Discord Server"
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  required
                />
              </div>

              {activeTab === 'discord' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Discord Webhook URL
                  </label>
                  <input
                    type="url"
                    value={formData.webhookUrl || ''}
                    onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                    placeholder="https://discord.com/api/webhooks/..."
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    Get this from Discord Server Settings → Integrations → Webhooks
                  </p>
                </div>
              )}

              {activeTab === 'telegram' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Bot Token
                    </label>
                    <input
                      type="password"
                      value={formData.botToken || ''}
                      onChange={(e) => setFormData({ ...formData, botToken: e.target.value })}
                      placeholder="Your Telegram bot token"
                      className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Chat ID
                    </label>
                    <input
                      type="text"
                      value={formData.chatId || ''}
                      onChange={(e) => setFormData({ ...formData, chatId: e.target.value })}
                      placeholder="Your Telegram chat ID"
                      className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                      required
                    />
                  </div>
                </>
              )}

              {activeTab === 'email' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="your@email.com"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>
              )}

              {activeTab === 'webhook' && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Webhook URL
                  </label>
                  <input
                    type="url"
                    value={formData.url || ''}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    placeholder="https://example.com/webhook"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                    required
                  />
                </div>
              )}

              <div className="flex gap-2 pt-4">
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  Create Channel
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
        ) : channels.length === 0 ? (
          <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-12 text-center">
            <p className="text-slate-400 mb-4">No notification channels configured</p>
            <p className="text-slate-500 text-sm mb-6">Add a channel to receive alerts</p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {channelTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab)
                    setShowForm(true)
                  }}
                  className="p-4 bg-slate-900/50 hover:bg-slate-900/80 border border-slate-700 rounded-lg transition-colors"
                >
                  <div className="text-2xl mb-2">{channelIcons[tab]}</div>
                  <p className="text-white text-sm font-medium capitalize">{tab}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-6 flex items-center justify-between"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="text-3xl">
                    {channelIcons[channel.channelType as ChannelType]}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{channel.channelName}</h3>
                    <p className="text-slate-400 text-sm capitalize">
                      {channel.channelType}
                    </p>
                    <p className="text-slate-500 text-xs mt-1">
                      Created: {new Date(channel.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleToggle(channel.id, channel.isActive)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      channel.isActive
                        ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                        : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {channel.isActive ? 'Active' : 'Inactive'}
                  </button>

                  <button
                    onClick={() => handleDelete(channel.id)}
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
