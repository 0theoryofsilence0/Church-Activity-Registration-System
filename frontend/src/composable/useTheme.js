import { ref, watch } from 'vue'

const KEY = 'cars_theme'
const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
const initial = (typeof window !== 'undefined' && localStorage.getItem(KEY)) || (prefersDark ? 'dark' : 'light')

const isDark = ref(initial === 'dark')

function applyTheme(dark) {
  if (typeof document === 'undefined') return
  if (dark) document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
}

applyTheme(isDark.value)

watch(isDark, (v) => {
  try { localStorage.setItem(KEY, v ? 'dark' : 'light') } catch (e) {}
  applyTheme(v)
})

function toggleTheme() { isDark.value = !isDark.value }

export function useTheme() { return { isDark, toggleTheme } }
