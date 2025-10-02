import { ref, computed } from "vue";

const activityName = ref("Church Connect - Activity Registration System");
const activityType = ref("Camp"); // "Camp" | "Fellowship"
const registrationFee = ref(500);
const logo = ref(null); // filename or null

const isCamp = computed(() => activityType.value === "Camp");
const isFellowship = computed(() => activityType.value === "Fellowship");

async function load() {
  try {
    const res = await fetch("/api/settings", { credentials: "include" });
    const data = await res.json();
    if (data?.ok && data.settings) {
      activityName.value = data.settings.activity_name ?? activityName.value;
      activityType.value = data.settings.activity_type ?? activityType.value;
      registrationFee.value =
        Number(data.settings.registration_fee ?? registrationFee.value) || 0;
        logo.value = data.settings.branding_logo || null;
    }
  } catch {}
}

async function saveSettings({ name, type, fee }) {
  const body = {};
  if (typeof name === "string") body.activity_name = name;
  if (typeof type === "string") body.activity_type = type;
  if (typeof fee !== "undefined") body.registration_fee = fee;
  if (logo.value != null) body.branding_logo = logo.value;

  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data?.ok && data.settings) {
    activityName.value = data.settings.activity_name;
    activityType.value = data.settings.activity_type;
    registrationFee.value = Number(data.settings.registration_fee) || 0;
    logo.value = data.settings.branding_logo || null;
  }
  return data;
}

export const branding = {
  activityName,
  activityType,
  registrationFee,
  isCamp,
  isFellowship,
  logo,
  load,
  saveSettings,
};
