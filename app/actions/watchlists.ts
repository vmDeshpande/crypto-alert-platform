'use server'

import { db } from '@/lib/db'
import { watchlists } from '@/lib/db/schema'
import { watchlistSchema } from '@/lib/schemas'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function getWatchlists() {
  try {
    const data = await db.select().from(watchlists).orderBy(desc(watchlists.createdAt))
    return { data, error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to fetch watchlists:', error)
    return { data: null, error: 'Failed to fetch watchlists' }
  }
}

export async function createWatchlist(input: unknown) {
  try {
    const validated = watchlistSchema.parse(input)

    const data = await db
      .insert(watchlists)
      .values({
        name: validated.name,
        description: validated.description,
        symbols: validated.symbols,
      })
      .returning()

    revalidatePath('/')
    revalidatePath('/watchlists')
    return { data: data[0], error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to create watchlist:', error)
    return { data: null, error: 'Failed to create watchlist' }
  }
}

export async function deleteWatchlist(id: string) {
  try {
    await db.delete(watchlists).where(eq(watchlists.id, id))
    revalidatePath('/')
    revalidatePath('/watchlists')
    return { error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to delete watchlist:', error)
    return { error: 'Failed to delete watchlist' }
  }
}