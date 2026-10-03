'use server'

import { loginSchema } from '@/lib/schemas'
import {
  validatePassword,
  createSession,
  destroySession,
  isPasswordProtected,
} from '@/lib/auth'

export async function login(input: unknown) {
  try {
    if (!(await isPasswordProtected())) {
      await createSession()
      return { success: true, error: null }
    }

    const validated = loginSchema.parse(input)

    if (!(await validatePassword(validated.password))) {
      return { success: false, error: 'Invalid password' }
    }

    await createSession()
    return { success: true, error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Login failed:', error)
    return { success: false, error: 'Authentication failed' }
  }
}

export async function logout() {
  try {
    await destroySession()
    return { error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Logout failed:', error)
    return { error: 'Failed to log out' }
  }
}