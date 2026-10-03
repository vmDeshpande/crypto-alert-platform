"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard-header";
import { Button } from "@/components/ui/button";
import { createAlert } from "@/app/actions/alerts";
import { getWatchlists } from "@/app/actions/watchlists";
import { getNotificationChannels } from "@/app/actions/notifications";
import {
  CONDITION_TYPES,
  CONDITION_LABELS,
  CONDITIONS_WITH_DEFAULT,
  type ConditionType,
} from "@/lib/schemas";

interface WatchlistOption {
  id: string;
  name: string;
  symbols: string[];
}

interface ChannelOption {
  id: string;
  channelName: string;
  channelType: string;
  isActive: boolean;
}

interface AlertForm {
  watchlistId: string;
  name: string;
  symbol: string;
  conditionType: ConditionType;
  conditionValue: string;
  notificationChannels: string[];
}

const inputClass =
  "w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-purple-500";

export default function NewAlertPage() {
  const router = useRouter();

  const [watchlists, setWatchlists] = useState<WatchlistOption[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<AlertForm>({
    watchlistId: "",
    name: "",
    symbol: "",
    conditionType: "price_above",
    conditionValue: "",
    notificationChannels: [],
  });

  async function loadOptions() {
    try {
      const [watchlistResult, channelResult] = await Promise.all([
        getWatchlists(),
        getNotificationChannels(),
      ]);

      setWatchlists((watchlistResult.data ?? []) as {
        id: string;
        name: string;
        symbols: string[];
      }[]);
      const channelRows = (channelResult.data ?? []) as {
        id: string;
        channelName: string;
        channelType: string;
        isActive: boolean | null;
      }[];

      setChannels(
        channelRows
          .filter((channel) => channel.isActive === true)
          .map((channel) => ({ ...channel, isActive: true })),
      );
    } catch (loadError) {
      console.error("[crypto-sentinel] Failed to load form options:", loadError);
      setError("Failed to load watchlists and notification channels");
    }
  }

  useEffect(() => {
    loadOptions();
  }, []);

  // Picking a watchlist prefills the symbol when the list holds exactly one.
  function handleWatchlistChange(watchlistId: string) {
    const watchlist = watchlists.find((row) => row.id === watchlistId);
    setForm((previous) => ({
      ...previous,
      watchlistId,
      symbol:
        previous.symbol || (watchlist?.symbols.length === 1 ? watchlist.symbols[0] : ""),
    }));
  }

  function toggleChannel(channelId: string) {
    setForm((previous) => ({
      ...previous,
      notificationChannels: previous.notificationChannels.includes(channelId)
        ? previous.notificationChannels.filter((id) => id !== channelId)
        : [...previous.notificationChannels, channelId],
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const needsThreshold = !CONDITIONS_WITH_DEFAULT.has(form.conditionType);
    if (needsThreshold && form.conditionValue.trim() === "") {
      setError("This condition needs a threshold value");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createAlert({
        watchlistId: form.watchlistId,
        name: form.name,
        symbol: form.symbol.trim().toUpperCase(),
        conditionType: form.conditionType,
        conditionValue:
          form.conditionValue.trim() === ""
            ? undefined
            : Number(form.conditionValue),
        notificationChannels: form.notificationChannels,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      router.push("/alerts");
      router.refresh();
    } catch (submitError) {
      console.error("[crypto-sentinel] Failed to create alert:", submitError);
      setError("Failed to create alert");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader />

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-white mb-2">Create Alert</h1>
        <p className="text-slate-400 mb-8">
          Alerts are evaluated on every cron run against the latest collected
          candles.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-8 space-y-6"
        >
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Watchlist
            </label>
            <select
              value={form.watchlistId}
              onChange={(event) => handleWatchlistChange(event.target.value)}
              className={inputClass}
              required
            >
              <option value="">Select a watchlist</option>
              {watchlists.map((watchlist) => (
                <option key={watchlist.id} value={watchlist.id}>
                  {watchlist.name} ({watchlist.symbols.length} symbols)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Alert name
            </label>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="BTC breaks 50k"
              className={inputClass}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Symbol
            </label>
            <input
              value={form.symbol}
              onChange={(event) =>
                setForm({ ...form, symbol: event.target.value })
              }
              placeholder="BTCUSD"
              className={inputClass}
              required
            />
            <p className="text-xs text-slate-500 mt-2">
              Must match a Delta Exchange symbol and appear in the watchlist.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Condition
            </label>
            <select
              value={form.conditionType}
              onChange={(event) =>
                setForm({
                  ...form,
                  conditionType: event.target.value as ConditionType,
                })
              }
              className={inputClass}
            >
              {CONDITION_TYPES.map((condition) => (
                <option key={condition} value={condition}>
                  {CONDITION_LABELS[condition]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Threshold
            </label>
            <input
              type="number"
              step="any"
              value={form.conditionValue}
              onChange={(event) =>
                setForm({ ...form, conditionValue: event.target.value })
              }
              placeholder={
                CONDITIONS_WITH_DEFAULT.has(form.conditionType)
                  ? "Optional — a default is used"
                  : "Required"
              }
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Notify via
            </label>
            {channels.length === 0 ? (
              <p className="text-sm text-slate-500">
                No active notification channels. Add one under Settings →
                Notifications, otherwise this alert will fire silently.
              </p>
            ) : (
              <div className="space-y-2">
                {channels.map((channel) => (
                  <label
                    key={channel.id}
                    className="flex items-center gap-3 bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.notificationChannels.includes(channel.id)}
                      onChange={() => toggleChannel(channel.id)}
                      className="accent-purple-500"
                    />
                    <span className="text-white text-sm">
                      {channel.channelName}
                    </span>
                    <span className="text-slate-500 text-xs uppercase ml-auto">
                      {channel.channelType}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              {isSubmitting ? "Creating..." : "Create Alert"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}