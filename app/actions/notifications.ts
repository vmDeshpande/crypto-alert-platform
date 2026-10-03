'use server'

import { db } from '@/lib/db'
import { notificationChannels } from '@/lib/db/schema'
import { notificationChannelSchema } from '@/lib/schemas'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function getNotificationChannels() {
  try {
    const data = await db
      .select()
      .from(notificationChannels)
      .orderBy(desc(notificationChannels.createdAt))
    return { data, error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to fetch notification channels:', error)
    return { data: null, error: 'Failed to fetch notification channels' }
  }
}

export async function createNotificationChannel(input: unknown) {
  try {
    const validated = notificationChannelSchema.parse(input)

    const data = await db
      .insert(notificationChannels)
      .values({
        channelType: validated.channelType,
        channelName: validated.channelName,
        config: validated.config,
        isActive: true,
      })
      .returning()

    revalidatePath('/settings/notifications')
    return { data: data[0], error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to create notification channel:', error)
    return { data: null, error: 'Failed to create notification channel' }
  }
}

export async function deleteNotificationChannel(id: string) {
  try {
    await db.delete(notificationChannels).where(eq(notificationChannels.id, id))
    revalidatePath('/settings/notifications')
    return { error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to delete notification channel:', error)
    return { error: 'Failed to delete notification channel' }
  }
}

export async function toggleNotificationChannel(id: string, isActive: boolean) {
  try {
    const data = await db
      .update(notificationChannels)
      .set({ isActive: !isActive, updatedAt: new Date() })
      .where(eq(notificationChannels.id, id))
      .returning()

    revalidatePath('/settings/notifications')
    return { data: data[0], error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to toggle notification channel:', error)
    return { data: null, error: 'Failed to toggle notification channel' }
  }
}