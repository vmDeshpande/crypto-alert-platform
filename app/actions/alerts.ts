'use server'

import { db } from '@/lib/db'
import { alerts } from '@/lib/db/schema'
import { alertSchema } from '@/lib/schemas'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function getAlerts() {
  try {
    const data = await db.select().from(alerts).orderBy(desc(alerts.createdAt))
    return { data, error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to fetch alerts:', error)
    return { data: null, error: 'Failed to fetch alerts' }
  }
}

export async function createAlert(input: unknown) {
  try {
    const validated = alertSchema.parse(input)

    const data = await db
      .insert(alerts)
      .values({
        watchlistId: validated.watchlistId,
        name: validated.name,
        symbol: validated.symbol,
        conditionType: validated.conditionType,
        conditionValue: validated.conditionValue,
        secondConditionType: validated.secondConditionType,
        secondConditionValue: validated.secondConditionValue,
        comparisonOperator: validated.comparisonOperator,
        notificationChannels: validated.notificationChannels,
        isActive: true,
      })
      .returning()

    revalidatePath('/')
    revalidatePath('/alerts')
    return { data: data[0], error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to create alert:', error)
    return { data: null, error: 'Failed to create alert' }
  }
}

export async function deleteAlert(id: string) {
  try {
    await db.delete(alerts).where(eq(alerts.id, id))
    revalidatePath('/')
    revalidatePath('/alerts')
    return { error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to delete alert:', error)
    return { error: 'Failed to delete alert' }
  }
}

export async function toggleAlert(id: string, isActive: boolean) {
  try {
    const data = await db
      .update(alerts)
      .set({ isActive: !isActive, updatedAt: new Date() })
      .where(eq(alerts.id, id))
      .returning()

    revalidatePath('/')
    revalidatePath('/alerts')
    return { data: data[0], error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to toggle alert:', error)
    return { data: null, error: 'Failed to toggle alert' }
  }
}