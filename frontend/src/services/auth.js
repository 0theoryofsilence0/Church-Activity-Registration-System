// src/services/auth.js
import { reactive } from 'vue'
import { withLoading, success as toastSuccess, error as toastError } from './ui'
// Use relative API path by default so Vite proxy (if enabled) will forward requests to the backend.
const API = import.meta.env.VITE_API || '';

export const auth = reactive({
  user: null,     // { username, role } or null
  loading: false,
  error: ''
})

export async function refreshMe() {
  try {
    auth.loading = true
    auth.error = ''
    const r = await fetch(`${API}/api/me`, { credentials: 'include' })
    const j = await r.json()
    auth.user = j?.user || null
  } catch (e) {
    auth.user = null
  } finally {
    auth.loading = false
  }
}

export async function login(username, password) {
  auth.loading = true
  auth.error = ''
  try {
    const j = await withLoading(async () => {
      const r = await fetch(`${API}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // IMPORTANT for cookie
        body: JSON.stringify({ username, password }),
      })
      const body = await r.json()
      if (!r.ok || !body.ok) throw new Error(body.error || 'Login failed')
      return body
    }, 'Signing in…')

    auth.user = j.user
    toastSuccess('Successful Login', 'Signed in')
    return true
  } catch (e) {
    auth.error = e.message || 'Login failed'
    auth.user = null
    toastError(auth.error, 'Error')
    return false
  } finally {
    auth.loading = false
  }
}

export async function logout() {
  try {
    await withLoading(async () => {
      await fetch(`${API}/api/logout`, { method: 'POST', credentials: 'include' })
    }, 'Signing out...')
    auth.user = null
    toastSuccess("You've been signed out.", 'Signed out')
  } catch (e) {
    toastError(e?.message || 'Logout failed', 'Error')
  }
}
