<script setup>
import { computed } from 'vue'
import { loadingVisible, loadingMessage, loadingProgress } from '../services/ui'

const visible = loadingVisible;
const message = loadingMessage;
const progress = loadingProgress;
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-[9998] flex items-center justify-center z-50">
      <!-- Dim background -->
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>

      <!-- Loader box -->
      <div class="relative z-10 w-full max-w-sm rounded-lg bg-white/95 p-6 shadow-lg">
        <div class="flex flex-col items-center gap-4">
          <!-- Circular spinner or progress ring -->
          <div v-if="progress === null" class="animate-spin rounded-full h-12 w-12 border-4 border-t-indigo-600 border-gray-200"></div>
          <div v-else class="w-full">
            <div class="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
              <div :style="{ width: progress + '%' }" class="h-full bg-indigo-600 transition-all"></div>
            </div>
            <div class="mt-2 text-xs text-gray-600 text-center">{{ progress }}%</div>
          </div>

          <div class="text-sm font-medium text-gray-900">{{ message || 'Working…' }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* small fade */
.fade-enter-from { opacity: 0 }
.fade-enter-active { transition: opacity .12s ease }
.fade-leave-to { opacity: 0 }
</style>
