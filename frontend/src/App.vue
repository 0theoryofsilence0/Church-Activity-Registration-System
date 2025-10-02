<script setup>
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { auth, logout } from "./services/auth";
import Modal from "./components/Modal.vue";
import SideNav from "./components/SideNav.vue";
import { branding } from "./services/branding";
import carsLogo from "./assets/cars-logo.png";
import ToastShelf from "./components/ToastShelf.vue";
import LoadingOverlay from './components/LoadingOverlay.vue'
import realtime from './services/realtime'
const router = useRouter();

// Sidenav state
const navExpanded = ref(false);
const NAV_COLLAPSED = 72;
const NAV_EXPANDED = 224;

// Shift content only when logged in; otherwise 0px
const pagePaddingLeft = computed(() =>
  auth.user
    ? navExpanded.value
      ? `${NAV_EXPANDED}px`
      : `${NAV_COLLAPSED}px`
    : "0px"
);  

// Modal state + confirm
const showLogoutModal = ref(false);
async function confirmLogout() {
  await logout();
  showLogoutModal.value = false;
  router.replace("/login");
}

// Forced logout modal when another device replaces this session
const forcedLogout = ref({ open: false, message: "Your session was replaced by another login.", details: null });
async function confirmForcedLogout() {
  try {
    await logout();
  } catch (e) {}
  forcedLogout.value.open = false;
  router.replace('/login');
}
// session invalidation handler (module-scoped so it can be removed)
const onSessionInvalidated = (ev) => {
  const data = (ev && ev.detail) || {};
  // show a modal so the user sees why they were logged out
  forcedLogout.value.message = data.message || 'Your session was replaced by another login.';
  forcedLogout.value.details = data;
  forcedLogout.value.open = true;
};

onMounted(() => {
  // start SSE connection for app-wide realtime events
  realtime.start();
  // load branding settings so public pages (login) can show logo/activity name
  branding.load();
  // listen for settings updates and reload branding
  document.addEventListener('realtime:settings:updated', branding.load);
  // listen for forced logout events from realtime service
  // preference: realtime service now dispatches 'realtime:session-invalidated'
  document.addEventListener('realtime:session-invalidated', onSessionInvalidated);
});

onUnmounted(() => {
  realtime.stop();
  document.removeEventListener('realtime:settings:updated', branding.load);
  document.removeEventListener('realtime:session-invalidated', onSessionInvalidated);
});

// header logo src handling
const headerLogoSrc = ref(carsLogo);
function setHeaderLogoFromBranding() {
  const v = branding.logo && branding.logo.value ? branding.logo.value : null;
  if (v) headerLogoSrc.value = `/uploads/${v}`;
  else headerLogoSrc.value = carsLogo;
}
function onHeaderLogoError() {
  headerLogoSrc.value = carsLogo;
}
setHeaderLogoFromBranding();
watch(() => branding.logo && branding.logo.value, setHeaderLogoFromBranding);
</script>

<template>
  <!-- Sidenav only when logged in -->
<ToastShelf />
<LoadingOverlay />
  <SideNav
    v-if="auth.user"
    v-model:expanded="navExpanded"
    @logout="showLogoutModal = true"
  />

  <!-- Page wrapper shifts with sidenav -->
  <div
    class="min-h-screen bg-gray-50 flex flex-col"
    :style="{ paddingLeft: pagePaddingLeft }"
  >
    <header v-if="auth.user" class="bg-white border-b"
    :class="auth.user ? '' : 'z-10'">
      <div
        class="mx-auto max-w-[100rem] text-center px-4 py-3 flex items-center"
      >
        <button
          class="mx-auto text-sm font-semibold text-center text-gray-900 hover:text-indigo-700 transition flex items-center gap-3"
          @click="router.push('/')"
        >
          <img :src="headerLogoSrc" alt="Logo" class="h-7 w-auto" @error="onHeaderLogoError" />
          <span>{{ branding.activityName }}</span>
        </button>
      </div>
    </header>

    <main class="mx-auto max-w-[100rem] px-4 w-full">
      <router-view />
    </main>

    <Modal
      :open="showLogoutModal"
      title="Confirm Logout"
      message="Are you sure you want to log out of the Youth Camp Registration System? You will need to sign in again to access your account."
      mode="confirm"
      @ok="confirmLogout"
      @cancel="showLogoutModal = false"
    />
    <!-- Forced-logout modal (session invalidation from another device) -->
    <Modal
      :open="forcedLogout.open"
      title="Session replaced"
      :message="forcedLogout.message"
      mode="confirm"
      :show-cancel="false"
      @ok="confirmForcedLogout"
      @cancel="confirmForcedLogout"
    />
  </div>
</template>
