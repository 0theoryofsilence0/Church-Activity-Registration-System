<script setup>
import { ref, watch } from 'vue'
import { login } from '../services/auth'
import { useRouter, useRoute } from 'vue-router'
import { branding } from '../services/branding'
import carsLogo from '../assets/cars-logo.png'

const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = ''
  const ok = await login(username.value.trim(), password.value)
  busy.value = false
  if (ok) {
    router.replace(route.query.redirect || '/')
  } else {
    error.value = 'Invalid username or password'
  }
}
</script>

<template>
  <div class="-mt-12 min-h-screen bg-gray-50 flex items-center justify-center px-4 sm:px-6 lg:px-8 flex-col gap-8 overflow-x-hidden box-border">

    <div class="flex items-center gap-2 flex-col">
      <img :src="carsLogo" alt="Logo" class="h-auto w-20 max-w-full" />
      <p class="text-xl">Church Activity Registration System v1</p>
    </div>

    <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 mx-auto box-border">
      <h1 class="text-xl font-semibold text-gray-900">Sign in</h1>
      <p class="mt-1 text-sm text-gray-500">Use your assigned account.</p>

      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <label class="block">
          <span class="text-sm font-medium text-gray-700">Username</span>
          <input
            v-model="username"
            type="text"
            class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            autocomplete="username"
            required
          />
        </label>

        <label class="block">
          <span class="text-sm font-medium text-gray-700">Password</span>
          <input
            v-model="password"
            type="password"
            class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            autocomplete="current-password"
            required
          />
        </label>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <button
          :disabled="busy"
          class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          <span v-if="busy">Signing in…</span>
          <span v-else>Sign in</span>
        </button>
      </form>
    </div>
  </div>
</template>
