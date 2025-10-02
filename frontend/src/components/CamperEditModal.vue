<script setup>
import { ref, watch, computed, onMounted } from "vue";
import BaseModal from "./BaseModal.vue";
import { branding } from "../services/branding";
import { error as toastError, info as toastInfo, withLoading } from "../services/ui";

const props = defineProps({
  open: Boolean,
  camperData: Object,
});
const emit = defineEmits(["close", "success"]);

const API = ""; // relative API base -> "/api/..."
const fetchWithCreds = (url, opts = {}) =>
  fetch(url, { credentials: "include", ...opts });

/* ---------- Branding flag ---------- */
const isCamp = computed(() => branding.isCamp.value);

/* ---------- State ---------- */
const form = ref({
  first_name: "",
  last_name: "",
  nickname: "",
  age: null,
  congregation: "",
  gender: "",
  is_leader: false,
  additional_info: "",
  sports: "",
});
const loading = ref(false);
const submitting = ref(false);
const formError = ref("");

/* ---------- UI classes ---------- */
const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const selectCls = inputCls;
const textareaCls = inputCls;
const labelCls = "text-sm font-medium text-gray-700";
const hintCls = "mt-1 text-xs text-gray-500";

/* When modal opens, fetch fresh camper data */
watch(
  () => props.open,
  (open) => {
    if (open && props.camperData?.id) fetchCamperForEdit(props.camperData.id);
    else resetForm();
  }
);

/* Optional: if activity switches to non-camp while open, hide sport.
   We keep the value, but you can uncomment to clear it.
*/
// watch(isCamp, (v) => { if (!v) form.value.sports = ""; });

/* ---------- Fetch ---------- */
async function fetchCamperForEdit(id) {
  loading.value = true;
  formError.value = "";
  try {
    const data = await withLoading(async () => {
      const r = await fetchWithCreds(`${API}/api/campers/${id}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.ok) throw new Error(body.message || "Failed to fetch attendee data.");
      return body;
    }, "Loading attendee details…");

    form.value = {
      first_name: data.camper.first_name || "",
      last_name: data.camper.last_name || "",
      nickname: data.camper.nickname || "",
      age: data.camper.age ?? null,
      congregation: data.camper.congregation || "",
      gender: data.camper.gender || "",
      is_leader: !!data.camper.is_leader,
      additional_info: data.camper.additional_info || "",
      sports: data.camper.sports || "",
    };
  } catch (e) {
    formError.value = e.message || "Failed to load attendee.";
    toastError(formError.value, "Error");
  } finally {
    loading.value = false;
  }
}

/* ---------- Submit ---------- */
async function handleSubmit() {
  if (submitting.value || loading.value) return;

  const id = props.camperData?.id;
  if (!id) {
    formError.value = "Attendee ID missing.";
    return;
  }

  submitting.value = true;
  formError.value = "";

  const payload = {
    ...form.value,
    age: form.value.age === null || form.value.age === "" ? null : Number(form.value.age),
    is_leader: form.value.is_leader ? 1 : 0,
    // If not Camp, don't send a sport preference (server ignores unknown fields anyway)
    ...(isCamp.value ? {} : { sports: "" }),
  };

  try {
    const data = await withLoading(async () => {
      const r = await fetchWithCreds(`${API}/api/campers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.ok) {
        let msg = body.message || "Failed to update attendee.";
        if (body.code === "DUPLICATE") {
          msg =
            "Update failed: Another attendee with this name, age, and congregation already exists.";
        }
        throw new Error(msg);
      }
      return body;
    }, "Saving changes…");

    emit("success", id);
  } catch (e) {
    formError.value = e.message || "Update failed.";
    toastError(formError.value, "Error");
  } finally {
    submitting.value = false;
  }
}

function resetForm() {
  form.value = {
    first_name: "",
    last_name: "",
    nickname: "",
    age: null,
    congregation: "",
    gender: "",
    is_leader: false,
    additional_info: "",
    sports: "",
  };
  formError.value = "";
}

/* ---------- Congregation suggestions ---------- */
const congregationsList = ref([]);
const showCongregationSuggestions = ref(false);
const congregationQuery = ref("");

const filteredCongregations = computed(() => {
  const q = (congregationQuery.value || form.value.congregation || "").toLowerCase().trim();
  if (!q) return congregationsList.value;
  return congregationsList.value.filter((c) => c.toLowerCase().includes(q));
});

async function fetchCongregations() {
  try {
    const r = await fetchWithCreds(`${API}/api/congregations`);
    if (!r.ok) return;
    const data = await r.json().catch(() => ({}));
    congregationsList.value = Array.isArray(data?.congregations)
      ? data.congregations.slice().sort()
      : [];
  } catch (e) {
    // ignore
  }
}

onMounted(() => fetchCongregations());

function selectCongregation(c) {
  form.value.congregation = c;
  congregationQuery.value = c;
  showCongregationSuggestions.value = false;
}

function handleClose() {
  emit("close");
  resetForm();
}

// Extracted handlers for template events
function onCongInput(e) {
  const val = e && e.target ? String(e.target.value || "") : String(form.value.congregation || "");
  form.value.congregation = val;
  congregationQuery.value = val;
  showCongregationSuggestions.value = true;
}
function onCongFocus(e) {
  const val = e && e.target ? String(e.target.value || "") : String(form.value.congregation || "");
  congregationQuery.value = val;
  showCongregationSuggestions.value = true;
}
function onCongBlur() {
  window.setTimeout(() => (showCongregationSuggestions.value = false), 150);
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="`Edit Attendee: ${camperData?.first_name || ''} ${camperData?.last_name || ''}`"
    @close="handleClose"
  >
    <div v-if="loading" class="p-6 text-center text-gray-500">Loading details...</div>

    <div
      v-else-if="formError && !submitting"
      class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      {{ formError }}
    </div>

    <form v-else @submit.prevent="handleSubmit">
      <!-- Identity -->
      <div class="border-b border-gray-100 px-6 py-5 sm:px-8 z-50">
        <h2 class="mb-4 flex items-center gap-2">
          <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold">1</span>
          <span class="text-base font-semibold text-gray-900">Identity</span>
        </h2>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="block">
            <span :class="labelCls">First Name *</span>
            <input v-model.trim="form.first_name" required :class="inputCls" placeholder="Juan" />
          </label>
          <label class="block">
            <span :class="labelCls">Surname *</span>
            <input v-model.trim="form.last_name" required :class="inputCls" placeholder="Dela Cruz" />
          </label>
          <label class="block">
            <span :class="labelCls">Nickname</span>
            <input v-model.trim="form.nickname" :class="inputCls" placeholder="Juanito (Optional)" />
          </label>
          <label class="block">
            <span :class="labelCls">Age</span>
            <input v-model.number="form.age" type="number" min="0" :class="inputCls" placeholder="18" />
          </label>
        </div>
      </div>

      <!-- Group & Role -->
      <div class="border-b border-gray-100 px-6 py-5 sm:px-8">
        <h2 class="mb-4 flex items-center gap-2">
          <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold">2</span>
          <span class="text-base font-semibold text-gray-900">Group & Role</span>
        </h2>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="block relative">
            <span :class="labelCls">Congregation</span>
            <input
              v-model="form.congregation"
              @input="onCongInput"
              @focus="onCongFocus"
              @blur="onCongBlur"
              :class="inputCls"
              placeholder="e.g., Mayumi"
            />

            <ul
              v-if="showCongregationSuggestions && filteredCongregations.length"
              class="absolute left-0 right-0 mt-1 max-h-40 overflow-auto rounded-md border bg-white shadow z-50"
            >
              <li
                v-for="c in filteredCongregations"
                :key="c"
                @mousedown.prevent="selectCongregation(c)"
                class="px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm"
              >
                {{ c }}
              </li>
            </ul>
          </label>
          <label class="block">
            <span :class="labelCls">Gender</span>
            <select v-model="form.gender" :class="selectCls">
              <option value="">Select…</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </label>

          <!-- Sport only for Camps -->
          <label v-if="isCamp" class="block sm:col-span-2">
            <span :class="labelCls">Sport Preference</span>
            <input
              v-model.trim="form.sports"
              :class="inputCls"
              placeholder="e.g., Basketball, Volleyball, or N/A"
            />
          </label>

          <div class="sm:col-span-2">
            <label class="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
              <input
                type="checkbox"
                v-model="form.is_leader"
                class="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <p class="text-sm font-medium text-gray-900">Church Leader</p>
                <p :class="hintCls">Tick this box if this attendee is a leader.</p>
              </div>
            </label>
          </div>
        </div>
      </div>

      <!-- Additional Info -->
      <div class="px-6 py-5 sm:px-8">
        <h2 class="mb-4 flex items-center gap-2">
          <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold">3</span>
          <span class="text-base font-semibold text-gray-900">Additional Info</span>
        </h2>
        <label class="block">
          <span :class="labelCls">Allergies / Medical Conditions / Notes</span>
          <textarea
            v-model.trim="form.additional_info"
            rows="3"
            :class="textareaCls"
            placeholder="Optional notes to help organizers (e.g., Seafoods allergy)"
          ></textarea>
        </label>
      </div>
    </form>

    <template #footer>
      <button
        type="button"
        @click="handleClose"
        class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        :disabled="submitting"
      >
        Cancel
      </button>
      <button
        type="button"
        @click="handleSubmit"
        class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="submitting || loading || !form.first_name || !form.last_name"
      >
        <span v-if="submitting">Saving...</span>
        <span v-else>Save Changes</span>
      </button>
    </template>
  </BaseModal>
</template>
