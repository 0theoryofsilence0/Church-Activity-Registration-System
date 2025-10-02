<!-- components/Modal.vue -->
<template>
  <div
    v-if="open"
    class="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50"
  >
    <div class="bg-white rounded shadow-lg w-full max-w-md p-6">
      <h3 v-if="title" class="text-lg font-semibold mb-2">{{ title }}</h3>
      <p class="mb-4 whitespace-pre-line">{{ message }}</p>

      <div class="flex justify-end gap-3">
        <button
          v-if="mode === 'confirm' && showCancel"
          @click="$emit('cancel')"
          class="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
        >
          Cancel
        </button>
        <button
          @click="$emit('ok')"
          class="px-4 py-2 rounded text-white"
          :class="
            mode === 'confirm'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-blue-600 hover:bg-blue-700'
          "
        >
          {{ mode === "confirm" ? "Confirm" : "OK" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  open: Boolean,
  title: String,
  message: String,
  mode: { type: String, default: "notice" }, // "notice" | "confirm"
  showCancel: { type: Boolean, default: true },
});
defineEmits(["ok", "cancel"]);
</script>
