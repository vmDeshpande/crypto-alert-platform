"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardHeader } from "@/components/dashboard-header";
import { Button } from "@/components/ui/button";
import { deleteAlert, getAlerts, toggleAlert } from "@/app/actions/alerts";

interface AlertRow {
  id: string;
  name: string;
  symbol: string;
  conditionType: string;
  conditionValue: number | null;
  isActive: boolean;
  createdAt: Date;
  lastTriggeredAt: Date | null;
}

function describeCondition(row: AlertRow): string {
  if (row.conditionValue === null) return row.conditionType;
  return `${row.conditionType} (${row.conditionValue})`;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function loadAlerts() {
    try {
      const result = await getAlerts();
      if (result.data) setAlerts(result.data as AlertRow[]);
    } catch (error) {
      console.error("[crypto-sentinel] Failed to load alerts:", error);
      window.alert("Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlerts();
  }, []);

  async function handleToggle(target: AlertRow) {
    setBusyId(target.id);
    try {
      const result = await toggleAlert(target.id, target.isActive);

      if (result.error) {
        window.alert(result.error);
        return;
      }

      setAlerts((previous) =>
        previous.map((row) =>
          row.id === target.id ? { ...row, isActive: !row.isActive } : row,
        ),
      );
    } catch (error) {
      console.error("[crypto-sentinel] Failed to toggle alert:", error);
      window.alert("Failed to toggle alert");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(alertId: string) {
    if (!window.confirm("Are you sure you want to delete this alert?")) return;

    setBusyId(alertId);
    try {
      const result = await deleteAlert(alertId);

      if (result.error) {
        window.alert(result.error);
        return;
      }

      setAlerts((previous) => previous.filter((row) => row.id !== alertId));
    } catch (error) {
      console.error("[crypto-sentinel] Failed to delete alert:", error);
      window.alert("Failed to delete alert");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <DashboardHeader />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Alerts</h1>
            <p className="text-slate-400 mt-2">
              Price and technical-indicator alerts
            </p>
          </div>

          <Link href="/alerts/new">
            <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
              Create Alert
            </Button>
          </Link>
        </div>

        {loading ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
            <p className="text-slate-400">Loading alerts...</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className="bg-slate-800/50 backdrop-blur border border-purple-500/10 rounded-xl p-12 text-center">
            <p className="text-slate-400 mb-4">No alerts yet</p>
            <p className="text-slate-500 text-sm">
              Create your first alert to monitor price movements and technical
              indicators.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {alerts.map((row) => (
              <div
                key={row.id}
                className="bg-slate-800/50 border border-slate-700 rounded-xl p-6"
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white">{row.name}</h3>

                    <p className="text-slate-400 mt-2">Symbol: {row.symbol}</p>

                    <p className="text-slate-400 mt-1">
                      Condition: {describeCondition(row)}
                    </p>

                    <p className="text-slate-400 mt-1">
                      Status:{" "}
                      <span
                        className={
                          row.isActive
                            ? "text-green-400 font-medium"
                            : "text-red-400 font-medium"
                        }
                      >
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                    </p>

                    {row.lastTriggeredAt && (
                      <p className="text-slate-500 text-sm mt-2">
                        Last Triggered: {row.lastTriggeredAt.toLocaleString()}
                      </p>
                    )}

                    <p className="text-slate-500 text-sm mt-1">
                      Created: {row.createdAt.toLocaleString()}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-3">
                    <div
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        row.isActive
                          ? "bg-green-500/20 text-green-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {row.isActive ? "ACTIVE" : "INACTIVE"}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() => handleToggle(row)}
                        className={
                          row.isActive
                            ? "bg-yellow-600 hover:bg-yellow-700"
                            : "bg-green-600 hover:bg-green-700"
                        }
                      >
                        {busyId === row.id
                          ? "Please wait..."
                          : row.isActive
                            ? "Disable"
                            : "Enable"}
                      </Button>

                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyId === row.id}
                        onClick={() => handleDelete(row.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}