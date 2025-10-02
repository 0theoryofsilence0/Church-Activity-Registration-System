<script setup>
import { ref, computed, onMounted } from "vue";
import Modal from "../components/Modal.vue";
import { useRouter } from "vue-router";
import { branding } from "../services/branding";
import { withLoading, success as toastSuccess, error as toastError, info as toastInfo } from "../services/ui";

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
        toastSuccess("Receipt sent to printer", "Success");
      } else {
        toastError(j?.error || "Failed to print receipt", "Error");
      }
    }, "Sending receipt to printer…")
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
        toastInfo(j.message || "Duplicate attendee. Already exists.", "Duplicate");
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
    }, "Registering attendee…")

    // Reset form only on success
    form.value = {
      first_name: "",
      last_name: "",
      nickname: "",
      age: "",
      congregation: "",
      gender: "",
      is_leader: false,
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

// Handlers extracted from template to avoid using setTimeout or complex expressions in the template
function onCongInput(e) {
  const val = e && e.target ? String(e.target.value || "") : String(form.value.congregation || "");
  // keep form in sync (v-model also does this, but setting explicitly is safe)
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
  // small delay to allow click events on suggestions (mousedown) to register
  window.setTimeout(() => (showCongregationSuggestions.value = false), 150);
}
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

              <label
                class="flex items-center gap-3 sm:col-span-2 rounded-lg border border-gray-200 p-3"
              >
                <input
                  type="checkbox"
                  v-model="form.is_leader"
                  class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p class="text-sm font-medium text-gray-900">Church Leader</p>
                  <p :class="hintCls">Tick if this attendee is a leader.</p>
                </div>
              </label>
            </div>
          </div>

          <!-- Section: Notes -->
          <div class="p-6 sm:p-8">
            <h2 class="mb-4 flex items-center gap-2">
              <span
                class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold"
                >3</span
              >
              <span class="text-base font-semibold text-gray-900"
                >Additional Info</span
              >
            </h2>
            <label class="block">
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

            <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                :disabled="submitting"
                class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
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

      <!-- Receipt Preview Modal -->
      <div
        v-if="receipt.open && receipt.camper"
        class="fixed inset-0 z-50 flex items-center justify-center px-3"
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
              <h3 class="text-base font-semibold text-gray-900">
                Receipt Preview
              </h3>
              <p class="mt-0.5 text-xs text-gray-500">
                Generated: {{ new Date().toLocaleString() }}
              </p>
            </div>
            <button
              @click="closeReceiptPreview"
              class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div class="px-6 py-5">
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-semibold text-gray-900">Youth Camp</p>
                  <p class="text-xs text-gray-500">Payment Receipt (Preview)</p>
                </div>
                <!-- Amount chip only shown for Camp -->
                <div
                  v-if="isCamp"
                  class="rounded-full bg-indigo-600/10 px-3 py-1 text-xs font-semibold text-indigo-700"
                >
                  ₱{{ receipt.camper.amount }}
                </div>
              </div>

              <div class="my-4 h-px bg-gray-200"></div>

              <dl class="space-y-2">
                <div class="flex items-center justify-between text-sm">
                  <dt class="text-gray-600">Invoice #</dt>
                  <dd class="font-medium text-gray-900">
                    {{ receipt.camper.invoice_no || "—" }}
                  </dd>
                </div>
                <div class="flex items-center justify-between text-sm">
                  <dt class="text-gray-600">Attendee</dt>
                  <dd class="font-medium text-gray-900">
                    {{ receipt.camper.first_name }}
                    {{ receipt.camper.last_name }}
                    <span
                      v-if="receipt.camper.nickname"
                      class="font-normal text-gray-500"
                      >({{ receipt.camper.nickname }})</span
                    >
                  </dd>
                </div>
                <div class="flex items-center justify-between text-sm">
                  <dt class="text-gray-600">Congregation</dt>
                  <dd class="text-gray-900">
                    {{ receipt.camper.congregation || "-" }}
                  </dd>
                </div>
                <div class="flex items-center justify-between text-sm">
                  <dt class="text-gray-600">Paid</dt>
                  <dd class="text-gray-900">Yes</dd>
                </div>
              </dl>

              <p class="mt-4 text-xs text-gray-500">
                This is a preview of the receipt that will be sent to the
                printer.
              </p>
            </div>
          </div>

          <div
            class="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4"
          >
            <button
              @click="closeReceiptPreview"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              :disabled="receipt.busy"
              @click="printFromPreview"
              class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
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
