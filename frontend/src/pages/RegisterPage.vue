<script setup>
import { ref, computed, onMounted, watch } from "vue";
import Modal from "../components/Modal.vue";
import { useRouter } from "vue-router";
import { branding } from "../services/branding";
import {
  withLoading,
  success as toastSuccess,
  error as toastError,
  info as toastInfo,
} from "../services/ui";
import carsLogo from "../assets/cars-logo.png";

const router = useRouter();

// Same-origin so cookies flow through the Vite proxy
const API = "";
const fetchWithCreds = (url, opts = {}) =>
  fetch(url, { credentials: "include", ...opts });

/* ---------- Branding-aware flags/values ---------- */
const isCamp = computed(() => branding.isCamp.value);
const fee = computed(() => Number(branding.registrationFee.value || 0));
const feeFixed2 = computed(() => fee.value.toFixed(2));
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

const registerAgain = () => router.go(0);

/* ---------- Form state ---------- */
const form = ref({
  first_name: "",
  last_name: "",
  nickname: "",
  age: "",
  congregation: "",
  gender: "",
  is_leader: false,
  is_baptized: false,
  is_guardian: false,
  additional_info: "",
  sports: "",
});
const submitting = ref(false);
const success = ref(null); // { id, name, invoice_no, snapshot }
const printed = ref(false);

/* ---------- Global notice modal ---------- */
const modal = ref({
  open: false,
  title: "",
  message: "",
  mode: "notice",
  onOk: null,
});
function showNotice(msg, title = "Notice") {
  modal.value = {
    open: true,
    title,
    message: msg,
    mode: "notice",
    onOk: () => (modal.value.open = false),
  };
}

/* ---------- Receipt preview modal ---------- */
const receipt = ref({ open: false, camper: null, busy: false });

async function openReceiptPreviewFromSuccess() {
  if (!success.value?.id) return;
  const s = success.value.snapshot || {};
  receipt.value.camper = {
    id: success.value.id,
    first_name: s.first_name || "",
    last_name: s.last_name || "",
    nickname: s.nickname || "",
    congregation: s.congregation || "",
    paid: true,
    amount: feeFixed2.value, // dynamic amount
    invoice_no: success.value.invoice_no || "",
    created_at: new Date().toISOString(), // Current timestamp for new registration
  };
  receipt.value.open = true;
  receipt.value.busy = false;
}
function closeReceiptPreview() {
  receipt.value.open = false;
  receipt.value.camper = null;
  receipt.value.busy = false;
}
async function printFromPreview() {
  if (!receipt.value.camper) return;
  receipt.value.busy = true;
  try {
    await withLoading(async () => {
      const r = await fetchWithCreds(
        `${API}/api/campers/${receipt.value.camper.id}/print-receipt`,
        { method: "POST" }
      );
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        printed.value = true;
        closeReceiptPreview();
        const message = j.message || "Receipt sent to printer";
        toastSuccess(message, "Success");
      } else {
        toastError(j?.error || "Failed to print receipt", "Error");
      }
    }, "Sending receipt to printer…");
  } catch {
    toastError("Failed to print receipt", "Error");
  } finally {
    receipt.value.busy = false;
  }
}

/* ---------- Duplicate check & submit ---------- */
async function existsCheck() {
  const params = new URLSearchParams({
    first_name: form.value.first_name || "",
    last_name: form.value.last_name || "",
    age: String(form.value.age ?? ""),
    congregation: form.value.congregation || "",
  });
  const r = await fetchWithCreds(
    `${API}/api/campers/exists?${params.toString()}`
  );
  const data = await r.json();
  return !!data.exists;
}

async function submitForm() {
  submitting.value = true;
  success.value = null;
  printed.value = false;
  try {
    if (await existsCheck()) {
      showNotice(
        "This attendee already exists (same name, age, and congregation).",
        "Duplicate"
      );
      return;
    }

    await withLoading(async () => {
      const snapshot = { ...form.value };
      const r = await fetchWithCreds(`${API}/api/campers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });

      if (r.status === 409) {
        const j = await r.json().catch(() => ({}));
        toastInfo(
          j.message || "Duplicate attendee. Already exists.",
          "Duplicate"
        );
        return;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || `HTTP ${r.status}`);
      }

      const data = await r.json();
      if (!data.ok) throw new Error(data.message || "Failed to register");

      success.value = {
        id: data.id,
        name: `${snapshot.first_name} ${snapshot.last_name}`.trim(),
        invoice_no: data.invoice_no || "",
        snapshot,
      };
      toastSuccess(`Registered: ${success.value.name}`, "Success");
    }, "Registering attendee…");

    // Reset form only on success
    form.value = {
      first_name: "",
      last_name: "",
      nickname: "",
      age: "",
      congregation: "",
      gender: "",
      is_leader: false,
      is_baptized: false,
      is_guardian: false,
      additional_info: "",
      sports: "",
    };
  } catch (e) {
    toastError("Failed to register. " + (e?.message || ""), "Error");
  } finally {
    submitting.value = false;
  }
}

/* ---------- Tailwind tokens ---------- */
const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const selectCls =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const textareaCls =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const labelCls = "text-sm font-medium text-gray-700";
const hintCls = "text-xs text-gray-500";

/* Congregation suggestions */
const congregationsList = ref([]);
const congregationQuery = ref("");
const showCongregationSuggestions = ref(false);

const filteredCongregations = computed(() => {
  const q = (congregationQuery.value || form.value.congregation || "")
    .toLowerCase()
    .trim();
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

// Handlers extracted from template to avoid using setTimeout or complex expressions in the template
function onCongInput(e) {
  const val =
    e && e.target
      ? String(e.target.value || "")
      : String(form.value.congregation || "");
  // keep form in sync (v-model also does this, but setting explicitly is safe)
  form.value.congregation = val;
  congregationQuery.value = val;
  showCongregationSuggestions.value = true;
}
function onCongFocus(e) {
  const val =
    e && e.target
      ? String(e.target.value || "")
      : String(form.value.congregation || "");
  congregationQuery.value = val;
  showCongregationSuggestions.value = true;
}
function onCongBlur() {
  // small delay to allow click events on suggestions (mousedown) to register
  window.setTimeout(() => (showCongregationSuggestions.value = false), 150);
}

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
  <div class="min-h-[calc(100vh-4rem)] bg-gray-50 py-8">
    <section class="mx-auto max-w-[100rem] px-4">
      <!-- Header -->
      <header class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 tracking-tight">
            Register Attendee
          </h1>
          <p class="mt-1 text-sm text-gray-500">
            Fill in the details below. Fields marked with * are required.
          </p>
        </div>
      </header>

      <!-- Data Privacy Notice -->
      <div class="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
        <div class="flex items-center lg:items-start gap-3 flex-col lg:flex-row">
          <div class="flex-shrink-0">
            <svg
              class="h-5 w-5 text-blue-600"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fill-rule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clip-rule="evenodd"
              />
            </svg>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-blue-900">
              Data Privacy Notice
            </h3>
            <div class="mt-2 text-sm text-blue-800">
              <p>
                By registering, you consent to the collection and processing of
                your personal information for the purpose of organizing this
                church activity. Your data will be used solely for registration
                management, communication regarding the event, and safety
                purposes during the activity.
              </p>
              <p class="mt-2">
                We are committed to protecting your privacy and will not share
                your information with third parties without your consent, except
                as required by law or for emergency situations.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Card -->
      <div class="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <!-- Form -->
        <form v-if="!success" @submit.prevent="submitForm">
          <!-- Section: Identity -->
          <div class="border-b border-gray-100 p-6 sm:p-8">
            <h2 class="mb-4 flex items-center gap-2">
              <span
                class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold"
                >1</span
              >
              <span class="text-base font-semibold text-gray-900"
                >Identity</span
              >
            </h2>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label class="block">
                <span :class="labelCls">First Name *</span>
                <input
                  v-model="form.first_name"
                  required
                  :class="inputCls"
                  placeholder="Juan"
                />
              </label>
              <label class="block">
                <span :class="labelCls">Surname *</span>
                <input
                  v-model="form.last_name"
                  required
                  :class="inputCls"
                  placeholder="Dela Cruz"
                />
              </label>
              <label class="block">
                <span :class="labelCls">Nickname *</span>
                <input
                  v-model="form.nickname"
                  required
                  :class="inputCls"
                  placeholder="Juanito"
                />
              </label>
              <label class="block">
                <span :class="labelCls">Age *</span>
                <input
                  v-model="form.age"
                  type="number"
                  min="0"
                  required
                  :class="inputCls"
                  placeholder="18"
                />
              </label>
            </div>
          </div>

          <!-- Section: Group & Role -->
          <div class="border-b border-gray-100 p-6 sm:p-8">
            <h2 class="mb-4 flex items-center gap-2">
              <span
                class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold"
                >2</span
              >
              <span class="text-base font-semibold text-gray-900"
                >Group & Role</span
              >
            </h2>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 z-10">
              <label class="block relative">
                <span :class="labelCls">Congregation *</span>
                <input
                  v-model="form.congregation"
                  :class="inputCls"
                  required
                  placeholder="e.g., Mayumi"
                  @input="onCongInput"
                  @focus="onCongFocus"
                  @blur="onCongBlur"
                />

                <ul
                  v-if="
                    showCongregationSuggestions && filteredCongregations.length
                  "
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
                </select>
              </label>

              <!-- Sport field — visible only for Camps -->
              <label v-if="isCamp" class="block sm:col-span-2">
                <span :class="labelCls">Sport</span>
                <input
                  v-model="form.sports"
                  :class="inputCls"
                  placeholder="e.g., Basketball"
                />
              </label>

              <div class="flex gap-4 flex-col col-span-1 sm:col-span-2 w-full mt-5 lg:flex-row">
                <label
                  class="w-full h-full flex items-center gap-3 sm:col-span-2 rounded-lg border border-gray-200 p-3"
                >
                  <input
                    type="checkbox"
                    v-model="form.is_leader"
                    class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div class="flex gap-1 sm:gap-3 align-center items-start flex-col sm:flex-row sm:items-center">
                    <p class="text-sm font-medium text-gray-900">
                      Church Leader
                    </p>
                    <p :class="hintCls">
                      ( Tick if this attendee is a leader. )
                    </p>
                  </div>
                </label>

                <!-- Camp-only fields -->
                <label
                  v-if="isCamp"
                  class="w-full h-full flex gap-3 items-center sm:col-span-2 rounded-lg border border-gray-200 p-3"
                >
                  <input
                    type="checkbox"
                    v-model="form.is_baptized"
                    class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div class="flex gap-1 sm:gap-3 align-center items-start flex-col sm:flex-row sm:items-start">
                    <p class="text-sm font-medium text-gray-900">Baptized</p>
                    <p :class="hintCls">
                      ( Tick if this attendee is baptized. )
                    </p>
                  </div>
                </label>

                <label
                  class="w-full h-full flex gap-3 items-center sm:col-span-2 rounded-lg border border-gray-200 p-3"
                >
                  <input
                    type="checkbox"
                    v-model="form.is_guardian"
                    class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div class="flex gap-1 sm:gap-3 align-center items-start flex-col sm:flex-row sm:items-center">
                    <p class="text-sm font-medium text-gray-900">Guardian</p>
                    <p :class="hintCls">
                      ( Tick if this attendee is a guardian. )
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <!-- Section: Notes -->
          <div class="p-6 sm:p-8" >
            <h2 class="mb-4 flex items-center gap-2" 
                  v-if="isCamp">
              <span
                class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold"
                >3</span
              >
              <span class="text-base font-semibold text-gray-900"
                >Additional Info</span
              >
            </h2>
            <label class="block" 
                  v-if="isCamp">
              <span :class="labelCls"
                >Allergies / Medical Conditions / Notes</span
              >
              <textarea
                v-model="form.additional_info"
                rows="3"
                :class="textareaCls"
                placeholder="Optional notes to help organizers"
              ></textarea>
            </label>

            <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center justify-end">
              <button
                :disabled="submitting"
                class="inline-flex w-40 items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg
                  v-if="submitting"
                  class="mr-2 h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                {{ submitting ? "Submitting…" : "Submit" }}
              </button>

              <!-- Fixed amount hint — only for Camps, dynamic -->
              <p v-if="isCamp" :class="hintCls">
                Fixed amount: {{ peso.format(fee) }}
              </p>
            </div>
          </div>
        </form>

        <!-- Success state -->
        <div v-else class="p-6 sm:p-8">
          <div
            class="rounded-xl border border-green-200 bg-green-50 p-4 sm:p-5"
          >
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm font-semibold text-green-900">
                  Registered: {{ success.name }}
                </p>
                <p v-if="isCamp" class="mt-1 text-sm text-green-700">
                  Invoice # {{ success.invoice_no }}
                </p>
              </div>
            </div>
            <div class="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                v-if="isCamp"
                @click="openReceiptPreviewFromSuccess"
                class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
              >
                Print Receipt
              </button>
              <button
                @click="registerAgain"
                class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                Register Again
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Receipt preview modal -->
      <div
        v-if="receipt.open && receipt.camper && isCamp"
        class="fixed inset-0 z-50 flex items-center justify-center px-3 text-[1.05rem] sm:text-[1rem]"
        aria-modal="true"
        role="dialog"
      >
        <div
          class="absolute inset-0 bg-black/40"
          @click="closeReceiptPreview"
        ></div>
        <div
          class="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-gray-200"
        >
          <div
            class="flex items-center justify-between border-b border-gray-100 px-6 py-4"
          >
            <div>
              <h3 class="text-lg sm:text-base font-semibold text-gray-900">
                Receipt Preview
              </h3>
              <p class="mt-0.5 text-sm sm:text-xs text-gray-500">
                Generated: {{ new Date().toLocaleString() }}
              </p>
            </div>
            <button
              @click="closeReceiptPreview"
              class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 text-lg sm:text-base"
            >
              ✕
            </button>
          </div>

          <div class="px-6 py-5">
            <div
              class="rounded-xl border border-gray-200 bg-white p-8 sm:p-10 mb-6 flex flex-col text-sm font-mono"
              style="font-family: 'Courier New', monospace; white-space: pre-line;"
            >
              <div class="text-center">
                <div class="font-bold">        CHURCH ACTIVITY</div>
                <div class="font-bold">      PAYMENT RECEIPT</div>
              </div>
              
              <div class="my-2">================================</div>
              
              <div>Date/Time: {{ receipt.camper.created_at ? new Date(receipt.camper.created_at).toLocaleString('en-PH', { 
                      day: '2-digit',
                      month: '2-digit', 
                      year: 'numeric', 
                      hour: '2-digit', 
                      minute: '2-digit', 
                      second: '2-digit',
                      hour12: false 
                    }) : new Date().toLocaleString('en-PH', { 
                      day: '2-digit',
                      month: '2-digit', 
                      year: 'numeric', 
                      hour: '2-digit', 
                      minute: '2-digit', 
                      second: '2-digit',
                      hour12: false 
                    }) }}</div>
              <div>Receipt No: YC-{{ new Date().toISOString().slice(0,10).replace(/-/g,'') }}-{{ String(receipt.camper.id || '001').padStart(3, '0') }}</div>
              <div>Invoice No: {{ receipt.camper.invoice_no || 'N/A' }}</div>
              
              <div class="my-2">CUSTOMER INFORMATION:</div>
              <div>Name: {{ receipt.camper.first_name }} {{ receipt.camper.last_name }}</div>
              <div>Congregation: {{ receipt.camper.congregation || 'N/A' }}</div>
              
              <div class="my-2">PAYMENT DETAILS:</div>
              <div>--------------------------------</div>
              <div>Registration Fee     PHP {{ parseFloat(receipt.camper.amount || 0).toFixed(2) }}</div>
              <div>--------------------------------</div>
              <div>Total Amount Due     PHP {{ parseFloat(receipt.camper.amount || 0).toFixed(2) }}</div>
              <div>Amount Paid          PHP {{ parseFloat(receipt.camper.amount || 0).toFixed(2) }}</div>
              <div>Change               PHP   0.00</div>
              <div>================================</div>
              
              <div class="text-center font-bold my-2">      PAID IN FULL</div>
              
              <div class="text-center">Thank you for your payment!</div>
              <div class="text-center">See you at the event!</div>
              
              <div class="text-center mt-2">This serves as your official</div>
              <div class="text-center">receipt and proof of payment.</div>
              
              <div class="text-center mt-2">Keep this receipt for your records</div>
            </div>
          </div>

          <div
            class="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4"
          >
            <button
              @click="closeReceiptPreview"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-[1rem] sm:text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              :disabled="receipt.busy"
              @click="printFromPreview"
              class="rounded-lg bg-indigo-600 px-4 py-2.5 text-[1rem] sm:text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span v-if="receipt.busy">Printing…</span>
              <span v-else>Print</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Global Notice Modal -->
      <Modal
        v-bind="modal"
        @ok="modal.onOk && modal.onOk()"
        @cancel="modal.open = false"
      />
    </section>
  </div>
</template>
