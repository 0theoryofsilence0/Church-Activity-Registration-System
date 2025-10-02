<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from "vue";
import Modal from "../components/Modal.vue";
import BaseModal from "../components/BaseModal.vue";
import CamperEditModal from "../components/CamperEditModal.vue";
import { auth } from "../services/auth";
import { branding } from "../services/branding";
import { success as toastSuccess, error as toastError, info as toastInfo, withLoading } from "../services/ui";

const isSuper = computed(() => auth.user && auth.user.role === "super");
const isCamp = computed(() => branding.isCamp.value);

// Relative base so Vite proxy + same-origin cookies work
const API = ""; // `${API}/api/...` -> "/api/..."

const fetchWithCreds = (url, opts = {}) =>
  fetch(url, { credentials: "include", ...opts });

/* ---------- State ---------- */
const congregation = ref("All");
const age = ref("All");
const gender = ref("All");
const is_leader = ref("All");
const search = ref("");
const campers = ref([]);
const loading = ref(false);
const error = ref("");
const deletingIds = new Set();

/* ---------- Filter State for ALL options ---------- */
const allCongregations = ref([]);
const allAges = ref([]);
const allGenders = ref([]);
let initialDataFetched = false;

// module-scoped cleanup container for SSE listeners
let _idx_sse_cleanup = null;

/* ---------- Grand total (from API) ---------- */
const grandTotalAmount = ref(0);

async function fetchGrandTotal() {
  try {
    if (!isCamp.value) {
      grandTotalAmount.value = 0;
      return;
    }
    const r = await fetchWithCreds(`${API}/api/campers/total_amount`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    grandTotalAmount.value = Number(data?.grandTotal || 0);
  } catch (e) {
    console.error("Failed to fetch grand total:", e);
  }
}
// refresh totals when switching Camp <-> Fellowship
watch(isCamp, () => fetchGrandTotal());

/* ---------- Modals ---------- */
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
function showConfirm(msg, title, onOk) {
  modal.value = { open: true, title, message: msg, mode: "confirm", onOk };
}

const receipt = ref({ open: false, camper: null, busy: false });
function openReceiptPreview(c) {
  receipt.value = { open: true, camper: c, busy: false };
}
function closeReceiptPreview() {
  receipt.value = { open: false, camper: null, busy: false };
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
        closeReceiptPreview();
        toastSuccess("Receipt sent to printer", "Success");
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

/* ---------- Edit modal ---------- */
const edit = ref({ open: false, camper: null });
function openEditModal(camper) {
  edit.value = { open: true, camper };
}
function closeEditModal() {
  edit.value = { open: false, camper: null };
}
function handleEditSuccess() {
  closeEditModal();
  toastSuccess("Camper updated successfully.", "Update Success");
  fetchCampers();
  fetchGrandTotal();
}

/* ---------- Filter Logic ---------- */
function extractAllFilterOptions(data) {
  const congSet = new Set();
  const ageSet = new Set();
  const genderSet = new Set();
  data.forEach((c) => {
    if (c.congregation) congSet.add(c.congregation);
    if (c.age) ageSet.add(c.age);
    if (c.gender) genderSet.add(c.gender);
  });
  allCongregations.value = Array.from(congSet).sort();
  allAges.value = Array.from(ageSet).sort((a, b) => a - b);
  allGenders.value = Array.from(genderSet).sort();
}

const congregations = computed(() => ["All", ...allCongregations.value]);
const ages = computed(() => ["All", ...allAges.value]);
const genders = computed(() => ["All", ...allGenders.value]);
const is_leaders = computed(() => ["All", "Yes", "No"]);

const isFilterActive = computed(() => {
  return (
    congregation.value !== "All" ||
    age.value !== "All" ||
    gender.value !== "All" ||
    is_leader.value !== "All" ||
    search.value.trim() !== ""
  );
});

function resetFilters() {
  congregation.value = "All";
  age.value = "All";
  gender.value = "All";
  is_leader.value = "All";
  search.value = "";
}

/* ---------- Fetch Campers ---------- */
async function fetchCampers() {
  loading.value = true;
  error.value = "";

  // Step 1: Fetch ALL data once to populate filter options
  if (!initialDataFetched) {
    try {
      const r = await fetchWithCreds(`${API}/api/campers`); // unfiltered list
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      extractAllFilterOptions(data?.rows || []);
      initialDataFetched = true;
    } catch (e) {
      console.error("Failed to fetch initial filter data:", e);
    }
  }

  // Step 2: Fetch with current filters
  try {
    const params = new URLSearchParams();
    if (congregation.value !== "All")
      params.set("congregation", congregation.value);
    if (gender.value !== "All") params.set("gender", gender.value);
    if (age.value !== "All") params.set("age", age.value);
    if (is_leader.value !== "All")
      params.set("is_leader", is_leader.value === "Yes" ? "1" : "0");

    const r = await fetchWithCreds(`${API}/api/campers?${params.toString()}`);
    if (!r.ok) {
      if (r.status === 401) {
        error.value = "Session expired. Please log in again.";
        campers.value = [];
        return;
      }
      throw new Error(`HTTP ${r.status}`);
    }
    const data = await r.json();
    campers.value = data?.rows || [];
  } catch (e) {
    error.value = `Failed to load attendees: ${e.message}`;
    campers.value = [];
  } finally {
    loading.value = false;
  }
}

/* ---------- Print list ---------- */
const listPreview = ref({ open: false, busy: false });
function openListPreview() {
  listPreview.value = { open: true, busy: false };
}
function closeListPreview() {
  listPreview.value = { open: false, busy: false };
}
async function printList() {
  listPreview.value.busy = true;
  try {
    await withLoading(async () => {
      const body = {
        congregation: congregation.value,
        age: age.value,
        gender: gender.value,
        is_leader:
          is_leader.value === "All" ? "All" : is_leader.value === "Yes" ? 1 : 0,
      };
      const r = await fetchWithCreds(`${API}/api/print-camper-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (data.ok) {
        closeListPreview();
        toastSuccess("Camper list sent to printer", "Success");
      } else {
        toastError("Failed to print list", "Error");
      }
    }, "Sending list to printer…");
  } catch {
    toastError("Failed to print list", "Error");
  } finally {
    listPreview.value.busy = false;
  }
}

/* ---------- CSV Export ---------- */
function exportToSheet() {
  const rows = sortedCampers.value;

  // Get the activity name from branding
  const activityName = branding.activityName;

  const headers = [
    "Invoice #",
    "Name",
    "Nickname",
    "Congregation",
    "Age",
    "Gender",
    "Leader?",
  ];
  if (isCamp.value) headers.push("Amount");
  headers.push("Sports", "Additional Info");

  const esc = (val) => {
    const s = val == null ? "" : String(val);
    // Ensure the value is properly escaped if it contains commas, quotes, or newlines
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [];

  // 1. ADD: New row at the top with the activity name
  if (activityName) {
    lines.push(esc(activityName.value + " Master List"));
  }

  // Original Headers row
  lines.push(headers.map(esc).join(","));

  rows.forEach((c) => {
    const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
    const columns = [
      c.invoice_no ?? "-",
      name,
      c.nickname ?? "",
      c.congregation ?? "-",
      c.age ?? "-",
      c.gender ?? "-",
      c.is_leader ? "Yes" : "No",
    ];
    if (isCamp.value) columns.push(`₱${c.amount}`);
    columns.push(c.sports ?? "N/A", c.additional_info ?? "N/A");
    lines.push(columns.map(esc).join(","));
  });

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  // 2. FIX: Use the activity name for the file name, with a better fallback and robust check
  let baseName = activityName;
  if (!baseName || typeof baseName !== "string") {
    // Use a fallback if activityName is null, undefined, or not a string (e.g., [object Object])
    baseName = activityName.value + " Master List";
  }

  // Sanitation for filename: replace non-word characters (a-z, A-Z, 0-9, _) with underscores
  const safeBaseName = String(baseName).replace(/[^\w]/g, "_");
  a.download = `${safeBaseName}-${ts}.csv`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Delete ---------- */
async function deleteCamper(id, fullName) {
  if (!isSuper.value) return;
  showConfirm(`Delete ${fullName}?`, "Confirm Delete", async () => {
    // Close modal immediately to avoid duplicate clicks triggering multiple deletes
    modal.value.open = false;

    // Prevent concurrent deletes for the same id
    if (deletingIds.has(id)) return;
    deletingIds.add(id);
    try {
      await withLoading(async () => {
        const r = await fetchWithCreds(`${API}/api/campers/${id}`, {
          method: "DELETE",
        });

        // Try to parse JSON safely; backend may return no-body
        const j = await r.json().catch(() => null);

        if (r.ok && (j === null || j.ok === undefined || j.ok === true)) {
          // Success
          await fetchCampers();
          await fetchGrandTotal(); // keep the total in sync
          toastSuccess("Deleted", "Success");
        } else {
          const msg = (j && (j.message || j.error)) || `Failed to delete (HTTP ${r.status})`;
          toastError(msg, "Error");
        }
      }, "Deleting attendee…");
    } catch (e) {
      toastError(e?.message || "Failed to delete", "Error");
    } finally {
      deletingIds.delete(id);
    }
  });
}

/* ---------- Mount & watchers ---------- */
onMounted(async () => {
  await fetchCampers(); // populates filters first time
  await fetchGrandTotal(); // initial total
  // SSE-driven refresh: listen for camper/team changes and refresh list/totals
  // debounce to avoid multiple rapid fetches
  let _syncTimer = null;
  const scheduleRefresh = () => {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      try {
        await fetchCampers();
        await fetchGrandTotal();
      } catch (e) {}
      _syncTimer = null;
    }, 300);
  };

  const onCamperCreated = (ev) => scheduleRefresh();
  const onCamperUpdated = (ev) => scheduleRefresh();
  const onCamperDeleted = (ev) => scheduleRefresh();
  const onTeamsUpdated = (ev) => scheduleRefresh();
  const onTeamsCleared = (ev) => scheduleRefresh();

  document.addEventListener('realtime:campers:created', onCamperCreated);
  document.addEventListener('realtime:campers:updated', onCamperUpdated);
  document.addEventListener('realtime:campers:deleted', onCamperDeleted);
  document.addEventListener('realtime:teams:updated', onTeamsUpdated);
  document.addEventListener('realtime:teams:cleared', onTeamsCleared);

  // store cleanup refs on component for removal
  _idx_sse_cleanup = {
    onCamperCreated: onCamperCreated,
    onCamperUpdated: onCamperUpdated,
    onCamperDeleted: onCamperDeleted,
    onTeamsUpdated: onTeamsUpdated,
    onTeamsCleared: onTeamsCleared,
  };
});

onUnmounted(() => {
  const c = _idx_sse_cleanup;
  if (c) {
    document.removeEventListener('realtime:campers:created', c.onCamperCreated);
    document.removeEventListener('realtime:campers:updated', c.onCamperUpdated);
    document.removeEventListener('realtime:campers:deleted', c.onCamperDeleted);
    document.removeEventListener('realtime:teams:updated', c.onTeamsUpdated);
    document.removeEventListener('realtime:teams:cleared', c.onTeamsCleared);
    _idx_sse_cleanup = null;
  }
});

watch([congregation, age, gender, is_leader], async () => {
  await fetchCampers();
  currentPage.value = 1;
});

/* ---------- Search + sorting + paging ---------- */
const filteredAndSortedCampers = computed(() => {
  const term = search.value.toLowerCase().trim();
  if (!term) return campers.value;
  return campers.value.filter((c) => {
    const full = `${c.first_name} ${c.last_name}`.toLowerCase();
    const nick = (c.nickname || "").toLowerCase();
    const cong = (c.congregation || "").toLowerCase();
    const invoice = String(c.invoice_no || "");
    const info = (c.additional_info || "").toLowerCase();
    return (
      full.includes(term) ||
      nick.includes(term) ||
      cong.includes(term) ||
      invoice.includes(term) ||
      info.includes(term)
    );
  });
});
watch(search, () => (currentPage.value = 1));

// Default to newest-first by created_at so latest added attendee appears at the top
const sortKey = ref("created_at");
const sortOrder = ref("desc");
function sortBy(key) {
  sortKey.value === key
    ? (sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc")
    : ((sortKey.value = key), (sortOrder.value = "asc"));
}
const sortedCampers = computed(() => {
  return [...filteredAndSortedCampers.value].sort((a, b) => {
    const key = sortKey.value;
    let A = a[key] ?? "",
      B = b[key] ?? "";

    // If sorting by created_at, compare as dates
    if (key === "created_at") {
      const ta = A ? Date.parse(A) : 0;
      const tb = B ? Date.parse(B) : 0;
      if (ta < tb) return sortOrder.value === "asc" ? -1 : 1;
      if (ta > tb) return sortOrder.value === "asc" ? 1 : -1;
      return 0;
    }

    if (!isNaN(A) && !isNaN(B)) {
      A = Number(A);
      B = Number(B);
    } else {
      A = String(A).toLowerCase();
      B = String(B).toLowerCase();
    }
    return A < B
      ? sortOrder.value === "asc"
        ? -1
        : 1
      : A > B
      ? sortOrder.value === "asc"
        ? 1
        : -1
      : 0;
  });
});
watch([sortKey, sortOrder, campers], () => (currentPage.value = 1));

const pageSize = 10;
const currentPage = ref(1);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(sortedCampers.value.length / pageSize))
);
const pageStart = computed(() => (currentPage.value - 1) * pageSize);
const pageEnd = computed(() =>
  Math.min(sortedCampers.value.length, pageStart.value + pageSize)
);
const pagedCampers = computed(() =>
  sortedCampers.value.slice(pageStart.value, pageEnd.value)
);
function goToPage(p) {
  currentPage.value = Math.min(Math.max(1, p), totalPages.value);
}

/* ---------- Currency ---------- */
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});

/* ---------- UI text for receipts/lists ---------- */
const receiptSubtitle = computed(() =>
  isCamp.value ? "Payment Receipt (Preview)" : "Registration Receipt (Preview)"
);
const participantLabel = computed(() =>
  isCamp.value ? "Camper" : "Participant"
);
const listModalTitle = computed(() =>
  isCamp.value ? "Camper List Preview" : "Participant List Preview"
);

/* ---------- Styles ---------- */
const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const selectCls =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
const labelCls = "text-sm font-medium text-gray-700";
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] bg-gray-50 py-8">
    <section class="mx-auto max-w-[100rem] px-4">
      <header class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 tracking-tight">
            Attendees
          </h1>
          <p class="mt-1 text-sm text-gray-500">
            Filter the list and print receipts or the full roster.
          </p>
        </div>
        <div v-if="isCamp" class="flex gap-3 items-center">
          <div
            class="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 items-center"
            title="Total cash in hand across all PAID attendees"
          >
            Total Cash In Hand: {{ peso.format(grandTotalAmount) }}
          </div>
          <button
            v-if="isSuper"
            @click="openListPreview"
            class="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-green-700"
          >
            Print Attendees List
          </button>
          <button
            v-if="isSuper"
            @click="exportToSheet"
            class="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700"
          >
            Export to Sheet
          </button>
        </div>
      </header>

      <!-- Filters -->
      <div class="mb-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <div class="mb-3 flex justify-between items-center gap-5">
          <div class="w-4/5">
            <label class="block md:col-span-1">
              <span :class="labelCls">Search</span>
              <input
                type="text"
                v-model="search"
                :class="inputCls"
                placeholder="Name, Invoice, etc."
              />
            </label>
          </div>
          <div class="flex flex-col w-1/5">
            <span :class="labelCls">Reset Filter</span>
            <button
              @click="resetFilters"
              :disabled="!isFilterActive"
              class="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </div>
        <div
          class="grid grid-cols-1 gap-4 sm:grid-cols-4 md:grid-cols-4 items-center"
        >
          <label class="block">
            <span :class="labelCls">Congregation</span>
            <select v-model="congregation" :class="selectCls">
              <option v-for="c in congregations" :key="c" :value="c">
                {{ c }}
              </option>
            </select>
          </label>
          <label class="block">
            <span :class="labelCls">Age</span>
            <select v-model="age" :class="selectCls">
              <option v-for="a in ages" :key="a" :value="a">{{ a }}</option>
            </select>
          </label>
          <label class="block">
            <span :class="labelCls">Gender</span>
            <select v-model="gender" :class="selectCls">
              <option v-for="g in genders" :key="g" :value="g">{{ g }}</option>
            </select>
          </label>
          <label class="block">
            <span :class="labelCls">Leader</span>
            <select v-model="is_leader" :class="selectCls">
              <option v-for="opt in is_leaders" :key="opt" :value="opt">
                {{ opt }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <!-- Status -->
      <div
        v-if="error"
        class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {{ error }}
      </div>
      <div
        v-else-if="loading"
        class="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600"
      >
        Loading…
      </div>

      <!-- Table -->
      <div
        v-else
        class="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200"
      >
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th
                  v-if="isCamp"
                  class="px-4 py-3 text-left text-gray-600 text-xs uppercase tracking-wide cursor-pointer"
                  @click="sortBy('invoice_no')"
                >
                  Invoice #
                  <span v-if="sortKey === 'invoice_no'">
                    {{ sortOrder === "asc" ? "▲" : "▼" }}
                  </span>
                </th>
                <th
                  class="px-4 py-3 text-left text-gray-600 text-xs uppercase tracking-wide cursor-pointer"
                  @click="sortBy('first_name')"
                >
                  Name
                  <span v-if="sortKey === 'first_name'">
                    {{ sortOrder === "asc" ? "▲" : "▼" }}
                  </span>
                </th>
                <th
                  class="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-600"
                >
                  Nickname
                </th>
                <th
                  class="px-4 py-3 text-left text-gray-600 text-xs uppercase tracking-wide cursor-pointer"
                  @click="sortBy('congregation')"
                >
                  Congregation
                  <span v-if="sortKey === 'congregation'">
                    {{ sortOrder === "asc" ? "▲" : "▼" }}
                  </span>
                </th>
                <th
                  class="px-4 py-3 text-left text-gray-600 text-xs uppercase tracking-wide cursor-pointer"
                  @click="sortBy('age')"
                >
                  Age
                  <span v-if="sortKey === 'age'">
                    {{ sortOrder === "asc" ? "▲" : "▼" }}
                  </span>
                </th>
                <th
                  class="px-4 py-3 text-left text-gray-600 text-xs uppercase tracking-wide cursor-pointer"
                  @click="sortBy('gender')"
                >
                  Gender
                  <span v-if="sortKey === 'gender'">
                    {{ sortOrder === "asc" ? "▲" : "▼" }}
                  </span>
                </th>
                <th
                  class="px-4 py-3 text-left text-gray-600 text-xs uppercase tracking-wide cursor-pointer"
                  @click="sortBy('is_leader')"
                >
                  Leader?
                  <span v-if="sortKey === 'is_leader'">
                    {{ sortOrder === "asc" ? "▲" : "▼" }}
                  </span>
                </th>
                <!-- Amount header -->
                <th
                  v-if="isCamp"
                  class="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-600"
                >
                  Amount
                </th>
                <th
                  v-if="isCamp"
                  class="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-600"
                >
                  Sports
                </th>
                <th
                  class="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-600"
                >
                  Additional Info
                </th>
                <th
                  class="px-4 py-3 text-center text-xs uppercase tracking-wide text-gray-600"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr
                v-for="c in pagedCampers"
                :key="c.id"
                class="hover:bg-gray-50"
              >
                <td v-if="isCamp" class="px-4 py-3 text-sm text-gray-700">
                  {{ c.invoice_no || "-" }}
                </td>
                <td class="px-4 py-3 text-sm text-gray-900 flex gap-2 items-center">
                   <div
                      class="uppercase w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-sm font-semibold"
                    >
                      {{ (c.first_name || "").charAt(0)
                      }}{{ (c.last_name || "").charAt(0) }}
                    </div>
                    <div class="text-sm font-medium capitalize">
                        {{ c.first_name }} {{ c.last_name }}
                      </div>
                </td>
                <td class="px-4 py-3 text-sm text-gray-700 capitalize">
                  {{ c.nickname }}
                </td>
                <td class="px-4 py-3 text-sm text-gray-700 capitalize">
                  {{ c.congregation || "-" }}
                </td>
                <td class="px-4 py-3 text-sm text-gray-700">
                  {{ c.age || "-" }}
                </td>
                <td class="px-4 py-3 text-sm text-gray-700">
                  {{ c.gender || "-" }}
                </td>
                <td class="px-4 py-3 text-sm">
                  <span
                    :class="[
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                      c.is_leader
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-gray-50 text-gray-600 ring-1 ring-gray-200',
                    ]"
                  >
                    {{ c.is_leader ? "Yes" : "No" }}
                  </span>
                </td>
                <!-- Amount cell -->
                <td
                  v-if="isCamp"
                  class="px-4 py-3 text-sm font-medium text-gray-900"
                >
                  ₱{{ c.amount }}
                </td>
                <td v-if="isCamp" class="px-4 py-3 text-sm text-gray-700 capitalize">
                  {{ c.sports || "N/A" }}
                </td>
                <td class="px-4 py-3 text-sm text-gray-700 capitalize">
                  {{ c.additional_info || "N/A" }}
                </td>
                <td class="px-4 py-3">
                  <div class="flex gap-2 items-center align-center text-center justify-center">
                    <button
                      @click="openEditModal(c)"
                      class="inline-flex items-center justify-center rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition hover:bg-indigo-50"
                    >
                      Edit
                    </button>
                    <button
                      v-if="isCamp && isSuper"
                      @click="openReceiptPreview(c)"
                      class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700"
                    >
                      Receipt
                    </button>
                    <button
                      v-if="isSuper"
                      @click="
                        deleteCamper(c.id, `${c.first_name} ${c.last_name}`)
                      "
                      class="inline-flex items-center justify-center rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="!sortedCampers.length">
                <td
                  :colspan="isCamp ? 11 : 8"
                  class="px-4 py-6 text-center text-sm text-gray-500"
                >
                  No attendees found
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div
          class="flex flex-col gap-3 border-t border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="text-sm text-gray-600">
            Showing
            <span class="font-medium text-gray-900">
              {{ sortedCampers.length ? pageStart + 1 : 0 }}
            </span>
            –
            <span class="font-medium text-gray-900">{{ pageEnd }}</span>
            of
            <span class="font-medium text-gray-900">
              {{ sortedCampers.length }}
            </span>
            Attendees
          </div>
          <nav class="flex items-center gap-1">
            <button
              class="rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              :disabled="currentPage === 1"
              @click="goToPage(1)"
              aria-label="First page"
            >
              «
            </button>
            <button
              class="rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              :disabled="currentPage === 1"
              @click="goToPage(currentPage - 1)"
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              v-for="p in Math.min(7, totalPages)"
              :key="p + '-' + currentPage"
              class="rounded-md px-3 py-1 text-sm"
              :class="
                p === currentPage
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              "
              @click="
                goToPage(
                  Math.min(totalPages, Math.max(1, currentPage - 3) + (p - 1))
                )
              "
            >
              {{ Math.min(totalPages, Math.max(1, currentPage - 3) + (p - 1)) }}
            </button>
            <button
              class="rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              :disabled="currentPage === totalPages"
              @click="goToPage(currentPage + 1)"
              aria-label="Next page"
            >
              ›
            </button>
            <button
              class="rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40"
              :disabled="currentPage === totalPages"
              @click="goToPage(totalPages)"
              aria-label="Last page"
            >
              »
            </button>
          </nav>
        </div>
      </div>

      <!-- Receipt preview modal -->
      <div
        v-if="receipt.open && receipt.camper && isCamp"
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
                  <p class="text-sm font-semibold text-gray-900">
                    {{ branding.activityName }}
                  </p>
                  <p class="text-xs text-gray-500">{{ receiptSubtitle }}</p>
                </div>
                <div
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
                  <dt class="text-gray-600">{{ participantLabel }}</dt>
                  <dd class="font-medium text-gray-900">
                    {{ receipt.camper.first_name }}
                    {{ receipt.camper.last_name }}
                    <span
                      v-if="receipt.camper.nickname"
                      class="font-normal text-gray-500"
                    >
                      ({{ receipt.camper.nickname }})
                    </span>
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

      <Modal
        v-bind="modal"
        @ok="modal.onOk && modal.onOk()"
        @cancel="modal.open = false"
      />
    </section>

    <CamperEditModal
      :open="edit.open"
      :camper-data="edit.camper"
      @close="closeEditModal"
      @success="handleEditSuccess"
    />

    <BaseModal
      :open="listPreview.open"
      :title="listModalTitle"
      @close="closeListPreview"
    >
      <div class="max-h-[60vh] overflow-y-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 sticky top-0">
            <tr>
              <th
                class="px-3 py-2 text-left font-semibold text-gray-600 cursor-pointer"
                @click="sortBy('first_name')"
              >
                Name
                <span v-if="sortKey === 'first_name'">
                  {{ sortOrder === "asc" ? "▲" : "▼" }}
                </span>
              </th>
              <th
                class="px-3 py-2 text-left font-semibold text-gray-600 cursor-pointer"
                @click="sortBy('congregation')"
              >
                Congregation
                <span v-if="sortKey === 'congregation'">
                  {{ sortOrder === "asc" ? "▲" : "▼" }}
                </span>
              </th>
              <th
                class="px-3 py-2 text-left font-semibold text-gray-600 cursor-pointer"
                @click="sortBy('age')"
              >
                Age
                <span v-if="sortKey === 'age'">
                  {{ sortOrder === "asc" ? "▲" : "▼" }}
                </span>
              </th>
              <th
                class="px-3 py-2 text-left font-semibold text-gray-600 cursor-pointer"
                @click="sortBy('gender')"
              >
                Gender
                <span v-if="sortKey === 'gender'">
                  {{ sortOrder === "asc" ? "▲" : "▼" }}
                </span>
              </th>
              <th
                class="px-3 py-2 text-left font-semibold text-gray-600 cursor-pointer"
                @click="sortBy('is_leader')"
              >
                Leader?
                <span v-if="sortKey === 'is_leader'">
                  {{ sortOrder === "asc" ? "▲" : "▼" }}
                </span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="c in campers" :key="c.id">
              <td class="px-3 py-2">{{ c.first_name }} {{ c.last_name }}</td>
              <td class="px-3 py-2">{{ c.congregation || "-" }}</td>
              <td class="px-3 py-2">{{ c.age || "-" }}</td>
              <td class="px-3 py-2">{{ c.gender || "-" }}</td>
              <td class="px-3 py-2">{{ c.is_leader ? "Yes" : "No" }}</td>
            </tr>
            <tr v-if="!campers.length">
              <td colspan="5" class="px-3 py-4 text-center text-gray-500">
                No campers found
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <button
          @click="closeListPreview"
          class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          :disabled="listPreview.busy"
          @click="printList"
          class="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span v-if="listPreview.busy">Printing…</span>
          <span v-else>Print</span>
        </button>
      </template>
    </BaseModal>
  </div>
</template>
