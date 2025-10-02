<script setup>
import { computed } from "vue";

const props = defineProps({
  text: { type: String, default: "" },
  fallback: { type: String, default: "N/A" },
  maxWidth: { type: String, default: "200px" }, // customize per column
});

const displayText = computed(() =>
  props.text && props.text.trim().length ? props.text : props.fallback
);
</script>

<template>
  <td
    class="px-4 py-3 text-sm text-gray-700 truncate relative group align-top"
    :style="{ maxWidth }"
  >
    <!-- Truncated display -->
    <span class="inline-block truncate align-middle">
      {{ displayText }}
    </span>

    <!-- Tooltip (only if actual text exists) -->
    <div
      v-if="text"
      class="absolute left-0 top-[calc(100%+4px)] z-50 w-max max-w-sm rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg ring-1 ring-black/10 opacity-0 translate-y-1 transition duration-150 ease-out group-hover:opacity-100 group-hover:translate-y-0 pointer-events-none"
    >
      <span class="block whitespace-pre-line break-words">
        {{ text }}
      </span>
    </div>
  </td>
</template>
