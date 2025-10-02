<!-- components/BaseModal.vue -->
<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center px-3"
    aria-modal="true"
    role="dialog"
  >
    <!-- Overlay -->
    <div class="absolute inset-0 bg-black/40" @click="$emit('close')"></div>

    <!-- Modal dialog -->
    <div
      class="relative z-10 w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-gray-200"
    >
      <!-- Header -->
      <div
        v-if="title || closable"
        class="flex items-center justify-between border-b border-gray-100 px-6 py-4"
      >
        <h3 v-if="title" class="text-base font-semibold text-gray-900">
          {{ title }}
        </h3>
        <button
          v-if="closable"
          @click="$emit('close')"
          class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          ✕
        </button>
      </div>

      <!-- Body slot -->
      <div class="px-6 py-5">
        <slot />
      </div>

      <!-- Footer slot -->
      <div
        v-if="$slots.footer"
        class="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 z-50"
      >
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  open: Boolean,
  title: String,
  closable: { type: Boolean, default: true },
});

defineEmits(["close"]);
</script>
