'use server'

import { db } from '@/lib/db'
import { apiCredentials } from '@/lib/db/schema'
import { apiCredentialsSchema } from '@/lib/schemas'
import { encryptText } from '@/lib/encryption'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

/** Returns credential metadata only — ciphertext is never sent to the client. */
export async function getApiCredentials() {
  try {
    const rows = await db
      .select()
      .from(apiCredentials)
      .orderBy(desc(apiCredentials.createdAt))

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        exchange: row.exchange,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      error: null,
    }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to fetch credentials:', error)
    return { data: null, error: 'Failed to fetch credentials' }
  }
}

export async function createApiCredential(input: unknown) {
  try {
    const validated = apiCredentialsSchema.parse(input)

    const data = await db
      .insert(apiCredentials)
      .values({
        name: validated.name,
        exchange: 'delta',
        encryptedApiKey: encryptText(validated.apiKey),
        encryptedApiSecret: encryptText(validated.apiSecret),
        isActive: true,
      })
      .returning()

    revalidatePath('/settings')
    return { data: data[0], error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to create credential:', error)
    return { data: null, error: 'Failed to create credential' }
  }
}

export async function deleteApiCredential(id: string) {
  try {
    await db.delete(apiCredentials).where(eq(apiCredentials.id, id))
    revalidatePath('/settings')
    return { error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to delete credential:', error)
    return { error: 'Failed to delete credential' }
  }
}

export async function toggleApiCredential(id: string, isActive: boolean) {
  try {
    const data = await db
      .update(apiCredentials)
      .set({ isActive: !isActive, updatedAt: new Date() })
      .where(eq(apiCredentials.id, id))
      .returning()

    revalidatePath('/settings')
    return { data: data[0], error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to toggle credential:', error)
    return { data: null, error: 'Failed to toggle credential' }
  }
}