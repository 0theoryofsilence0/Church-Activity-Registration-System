<script setup>
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { auth } from "../services/auth";

import { branding } from "../services/branding";
import DashboardIcon from "../assets/dashboard-svgrepo-com.svg";
import RegisterIcon from "../assets/register-svgrepo-com.svg";
import GroupIcon from "../assets/group-svgrepo-com.svg";
import LogoutIcon from "../assets/logout-2-svgrepo-com.svg";
import carsLogo from "../assets/cars-logo.png";

const props = defineProps({ expanded: { type: Boolean, default: false } });
const emit = defineEmits(["update:expanded", "logout"]);

const COLLAPSED = 72;
const EXPANDED = 224;

// Hover state: when collapsed, hovering over the sidenav temporarily expands it
const hover = ref(false);
const isShownExpanded = computed(() => props.expanded || hover.value);

function toggle() {
  emit("update:expanded", !props.expanded);
}

const route = useRoute();
const isActive = (path) => computed(() => route.path === path).value;

const initials = computed(() => {
  const name = auth.user?.username || "";
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
});

</script>

<template>
  <aside
    class="fixed left-0 top-0 h-screen bg-white border-r overflow-hidden shadow-sm transition-[width] duration-300 flex flex-col z-20"
    :style="{ width: isShownExpanded ? EXPANDED + 'px' : COLLAPSED + 'px' }"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
  >
    <!-- Brand / Toggle -->
    <div class="flex items-center justify-between px-3 py-3 border-b">
      <button
        class="flex items-center gap-2 text-sm font-semibold text-gray-900 hover:text-indigo-700"
        @click="$router.push('/')"
      >
        <div class="h-9 w-9 grid place-items-center">
          <img :src="carsLogo" alt="Logo" class="h-auto w-9" />
        </div>
        <span v-if="isShownExpanded">Church Activity Registration System</span>
      </button>

      <button
        class="rounded-md text-gray-600 hover:text-gray-900 px-2 py-1"
        @click="toggle()"
      >
<!--       
        <span v-if="props.expanded">«</span>
        <span v-else>»</span> -->
      </button>
    </div>

    <!-- Nav -->
    <nav class="mt-2">
      <ul class="px-2 space-y-1">
        <li>
          <RouterLink
            to="/"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50"
            :class="isActive('/') ? 'bg-indigo-50 text-gray-900' : ''"
          >
            <DashboardIcon class="w-5 h-5 text-indigo-300" />
            <span v-if="isShownExpanded">Dashboard</span>
          </RouterLink>
        </li>

        <li>
          <RouterLink
            to="/register"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50"
            :class="isActive('/register') ? 'bg-indigo-50 text-gray-900' : ''"
          >
            <RegisterIcon class="w-5 h-5 text-indigo-300" />
            <span v-if="isShownExpanded">Register</span>
          </RouterLink>
        </li>

        <li v-if="auth.user?.role === 'super'">
          <RouterLink
            to="/teams"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50"
            :class="isActive('/teams') ? 'bg-indigo-50 text-gray-900' : ''"
          >
            <GroupIcon class="w-5 h-5 text-indigo-300" />
            <span v-if="isShownExpanded">Teams</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <!-- Bottom block (Account + Logout + App footer) -->
    <div class="mt-auto border-t px-3 py-3 flex flex-col items-center gap-3">
      <div v-if="auth.user" class="flex items-center gap-2 w-full justify-center align-center">
        <div class="h-9 w-9 rounded-full bg-gray-100 text-gray-700 grid place-items-center text-sm font-medium">
          {{ initials }}
        </div>
        <div v-if="isShownExpanded" class="min-w-0 flex gap-2 items-center justify-center align-center">
          <div class="text-sm font-medium text-gray-900 truncate">
            {{ auth.user.username }}
          </div>
          <div
            class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1"
            :class="
              auth.user.role === 'super'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : 'bg-gray-50 text-gray-700 ring-gray-200'
            "
          >
            {{ auth.user.role }}
          </div>
        </div>
      </div>
      <RouterLink
        v-if="auth.user?.role === 'super'"
        to="/settings"
        class="flex items-center justify-center gap-2 w-full rounded-md text-sm px-3 py-2 hover:bg-indigo-50 text-gray-700"
        :class="isActive('/settings') ? 'bg-indigo-50 text-gray-900' : ''"
      >
        <!-- simple gear icon (single-colored) -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#111827"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="w-5 h-5 text-indigo-300"
        >
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.82l.02.06a2 2 0 1 1-3.38 0l.02-.06A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82-.33l-.06.02a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.82-.33l-.06.02a2 2 0 1 1 0-3.38l.06.02A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.82-.33l-.06.02a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6c.35 0 .69-.12 1-.33a1.65 1.65 0 0 0 .33-1.82l-.02-.06a2 2 0 1 1 3.38 0l-.02.06c-.1.33-.07.69.06 1 .13.32.35.6.65.79.3.2.65.31 1 .31a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.25.25-.41.56-.47.89-.07.34-.01.7.16 1.01.17.3.45.53.77.66.33.13.69.15 1.02.05l.06-.02a2 2 0 1 1 0 3.38l-.06-.02c-.34-.1-.7-.07-1.01.06-.32.13-.6.35-.79.65a1.65 1.65 0 0 0-.31 1Z"
          />
        </svg>
        <span v-if="isShownExpanded" class="text-gray-700">Settings</span>
      </RouterLink>

      <button
        class="flex items-center justify-center gap-2 w-full rounded-md text-sm px-3 py-2 transition bg-indigo-600 hover:bg-indigo-700 text-white"
        @click="$emit('logout')"
      >
        <LogoutIcon class="w-5 h-5 text-indigo-300 flex-shrink-0" />
        <span v-if="isShownExpanded">Logout</span>
      </button>

      <!-- Moved footer text here -->
      <div v-if="isShownExpanded" class="w-full pt-2 text-[11px] text-gray-500 border-t text-center">
        <p class="pt-2">CARS v1</p>
        <p class="pt-2">Developed by Julius Enriquez &copy; 2025</p>
      </div>
    </div>
  </aside>
</template>
