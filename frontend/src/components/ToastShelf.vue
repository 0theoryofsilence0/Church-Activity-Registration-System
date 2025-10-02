<script setup>
import { computed } from "vue";
import { toasts, dismiss } from "../services/ui";

const titleCls = (t) =>
  t.type === "success"
    ? "text-emerald-700"
    : t.type === "error"
    ? "text-red-700"
    : "text-slate-800";
const iconPath = (t) =>
  t.type === "success"
    ? "M5 13l4 4L19 7"
    : t.type === "error"
    ? "M6 18L18 6M6 6l12 12"
    : "M13 16h-1v-4h-1m1-4h.01";
</script>

<template>
  <Teleport to="body">
  <div class="pointer-events-none fixed right-4 top-4 z-40 space-y-2">
      <TransitionGroup name="toast" tag="div">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="pointer-events-auto flex w-80 gap-3 rounded-xl bg-white p-3 shadow-lg ring-1 ring-black/5"
        >
          <div class="mt-0.5">
            <svg
              class="h-5 w-5"
              :class="{
                'text-emerald-600': t.type === 'success',
                'text-red-600': t.type === 'error',
                'text-slate-500': t.type !== 'success' && t.type !== 'error',
              }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="iconPath(t)" />
            </svg>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold" :class="titleCls(t)">
              {{ t.title }}
            </div>
            <p class="mt-0.5 text-sm text-slate-700 break-words">
              {{ t.message }}
            </p>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <button
              v-if="t.actionLabel"
              class="rounded-md px-2 py-1 text-sm text-blue-600 hover:bg-slate-50"
              @click="(e)=>{ t.action && t.action(); dismiss(t.id); }"
            >
              {{ t.actionLabel }}
            </button>
            <button
              class="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              @click="dismiss(t.id)"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.18s ease;
}
</style>
