<script setup>
import { ref, onMounted, computed } from "vue";
import carsLogo from '../assets/cars-logo.png';
import { watch } from "vue";
import { useRouter } from "vue-router";
import { auth } from "../services/auth";
import { branding } from "../services/branding";
import { success as toastSuccess, error as toastError, withLoading } from "../services/ui";
import Modal from "../components/Modal.vue";

const API = import.meta.env.VITE_API || '';
const router = useRouter();
const name = ref("");
const type = ref("Camp");
const fee = ref(0);

onMounted(async () => {
  if (!auth.user || auth.user.role !== "super") {
    router.replace("/");
    return;
  }
  await branding.load();
  name.value = branding.activityName.value;
  type.value = branding.activityType.value;
  fee.value = branding.registrationFee.value || 0;
});

const isCamp = computed(() => type.value === "Camp");

const previewData = ref(null); // dataURL for selected file preview
const selectedFileName = ref(null);
const selectedFile = ref(null);
const fileInput = ref(null);

// Modal state for database reset confirmation
const resetModal = ref({
  open: false,
  step: 1, // 1 = first warning, 2 = final confirmation
  title: "",
  message: "",
  onConfirm: null
});

async function save() {
  const payload = { name: name.value.trim(), type: type.value };
  if (isCamp.value) payload.fee = Number(fee.value) || 0;
  try {
    const res = await withLoading("Saving settings…", async () => {
      return await branding.saveSettings(payload);
    });

    if (res?.ok) {
      // toastSuccess("Settings saved", "Success");
      // navigate back after the loader hides (withLoading enforces min duration)
      // toast is global so it will persist across route change
      setTimeout(() => {
        history.length > 1 ? router.back() : router.push("/");
      }, 0);
    } else {
      toastError(res?.error || "Failed to save settings", "Error");
    }
  } catch (e) {
    toastError(e?.message || "Failed to save settings", "Error");
  }
}

function onSelectLogo(e) {
  const f = e.target.files && e.target.files[0];
  previewData.value = null;
  selectedFileName.value = null;
  if (!f) return;
  if (!f.type.startsWith('image/')) {
    toastError('Please select an image file', 'Invalid file');
    return;
  }
  // limit ~5MB for now
  if (f.size > 5 * 1024 * 1024) {
    toastError('File too large (max 5MB)', 'Invalid file');
    return;
  }
  selectedFileName.value = f.name;
  selectedFile.value = f;
  const reader = new FileReader();
  reader.onload = () => {
    previewData.value = reader.result;
  };
  reader.readAsDataURL(f);
}

async function uploadLogo() {
  if (!previewData.value || !selectedFileName.value) return toastError('No image selected', 'Upload');
  try {
    const res = await withLoading('Uploading logo…', async () => {
      // If we have a File object, prefer multipart/form-data upload
      if (selectedFile.value) {
        const fd = new FormData();
        fd.append('file', selectedFile.value, selectedFileName.value || selectedFile.value.name);
        const r = await fetch('/api/settings/logo', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        return await r.json();
      }
      // Fallback: JSON with base64 data (older behavior)
      const r = await fetch('/api/settings/logo', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selectedFileName.value, data: previewData.value }),
      });
      return await r.json();
    });
    if (res?.ok) {
      // update branding service
      branding.logo.value = res.file || null;
      // toastSuccess('Logo uploaded', 'Success');
      // clear preview
    previewData.value = null;
    selectedFileName.value = null;
    selectedFile.value = null;
    // reset file input element
    if (fileInput.value) fileInput.value.value = null;
  // reload branding from server so all fields are in sync
  await branding.load();
  console.log('branding after upload', branding.logo && branding.logo.value ? branding.logo.value : branding.logo);
    } else {
      toastError(res?.error || 'Failed to upload logo', 'Error');
    }
  } catch (e) {
    toastError(e?.message || 'Failed to upload logo', 'Error');
  }
}

function resetDatabase() {
  resetModal.value = {
    open: true,
    step: 1,
    title: "⚠️ DANGER: Reset Database",
    message: "This will permanently delete ALL camper registrations and cannot be undone. Are you absolutely sure you want to continue?",
    onConfirm: showFinalWarning
  };
}

function showFinalWarning() {
  resetModal.value = {
    open: true,
    step: 2,
    title: "🚨 FINAL WARNING",
    message: "This is your LAST CHANCE to cancel. All registration data will be permanently lost and cannot be recovered. This action is irreversible.",
    onConfirm: executeReset
  };
}

async function executeReset() {
  resetModal.value.open = false;
  
  try {
    const response = await withLoading("Resetting database…", async () => {
      return await fetch(`${API}/api/admin/reset-database`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
    });
    
    const data = await response.json().catch(() => ({}));
    
    if (response.ok && data.ok) {
      toastSuccess(`Database reset complete. ${data.deletedCount || 0} records deleted.`, "Reset Complete");
    } else {
      toastError(data.error || "Failed to reset database", "Error");
    }
  } catch (e) {
    toastError("Failed to reset database", "Error");
  }
}

function cancelReset() {
  resetModal.value.open = false;
}
</script>

<template>
  <div class="py-6 max-w-xl">
    <h1 class="text-2xl font-semibold mb-4">Settings</h1>

    <div v-if="auth.user?.role === 'super'" class="space-y-5">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1"
          >Activity Name</label
        >
        <input
          v-model="name"
          type="text"
          class="w-full rounded-md border px-3 py-2 text-sm"
        />
        <p class="mt-1 text-xs text-gray-500">
          Shown in header, receipts, lists, and exports.
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1"
          >Activity Type</label
        >
        <select
          v-model="type"
          class="w-full rounded-md border px-3 py-2 text-sm"
        >
          <option>Camp</option>
          <option>Fellowship</option>
        </select>
      </div>

      <div v-if="isCamp">
        <label class="block text-sm font-medium text-gray-700 mb-1"
          >Registration Fee (PHP)</label
        >
        <input
          v-model.number="fee"
          type="number"
          min="0"
          step="1"
          class="w-full rounded-md border px-3 py-2 text-sm"
        />
        <p class="mt-1 text-xs text-gray-500">
          Used to compute totals and print receipts.
        </p>
      </div>

      <div class="pt-2 flex gap-2">
        <button
          class="rounded-md bg-indigo-600 text-white px-4 py-2 text-sm hover:bg-indigo-700"
          @click="save"
        >
          Save
        </button>
        <button
          class="rounded-md border px-4 py-2 text-sm"
          @click="router.back()"
        >
          Cancel
        </button>
      </div>
      
      <div class="pt-6 border-t pt-4">
        <h2 class="text-lg font-medium mb-2">Branding Logo</h2>
        <p class="text-sm text-gray-500 mb-3">Optional logo shown in header and receipts.</p>

        <div class="flex items-center gap-4">
          <div class="w-36 h-20 bg-gray-100 border rounded flex items-center justify-center overflow-hidden">
            <img v-if="previewData" :src="previewData" alt="preview" class="max-h-20" @error="() => { previewData=null }" />
            <img v-else :src="branding.logo && branding.logo.value ? `/uploads/${branding.logo.value}` : carsLogo" alt="logo" class="max-h-20" @error="event => event.target.src = carsLogo" />
            <div v-if="!previewData && !branding.logo" class="text-xs text-gray-400">No logo</div>
          </div>

          <div class="flex-1">
            <input ref="fileInput" type="file" accept="image/*" @change="onSelectLogo" />
            <div class="mt-2 flex gap-2">
              <button class="rounded-md bg-green-600 text-white px-3 py-1 text-sm" @click="uploadLogo" :disabled="!previewData">Upload</button>
              <button class="rounded-md border px-3 py-1 text-sm" @click="() => { previewData=null; selectedFileName=null; if (fileInput) fileInput.value && (fileInput.value.value=null) }">Clear</button>
            </div>
            <p class="mt-2 text-xs text-gray-500">Max 5MB. PNG/JPEG recommended.</p>
          </div>
        </div>
      </div>
      
      <!-- Danger Zone -->
      <div class="pt-6 border-t border-red-200">
        <h2 class="text-lg font-medium mb-2 text-red-700">Danger Zone</h2>
        <p class="text-sm text-red-600 mb-4">⚠️ These actions are irreversible and will permanently delete data.</p>
        
        <button
          @click="resetDatabase"
          class="rounded-md bg-red-600 text-white px-4 py-2 text-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          Reset Database
        </button>
        <p class="mt-2 text-xs text-red-500">This will permanently delete all camper registrations.</p>
      </div>
    </div>

    <div v-else class="text-sm text-gray-600">Forbidden</div>
  </div>

  <!-- Database Reset Confirmation Modal -->
  <Modal
    :open="resetModal.open"
    :title="resetModal.title"
    :message="resetModal.message"
    mode="confirm"
    :ok-text="resetModal.step === 2 ? 'YES, DELETE EVERYTHING' : 'Continue'"
    :cancel-text="resetModal.step === 2 ? 'Cancel (Safe)' : 'Cancel'"
    @ok="resetModal.onConfirm"
    @cancel="cancelReset"
  />
</template>
