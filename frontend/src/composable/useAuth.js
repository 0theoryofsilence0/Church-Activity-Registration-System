// src/composables/useAuth.js
import { ref } from "vue";

export const me = ref(null);          // { username, role } | null
export const meLoading = ref(true);

export async function fetchMe() {
  meLoading.value = true;
  try {
    const r = await fetch("http://localhost:3001/api/me", { credentials: "include" });
    const j = await r.json();
    me.value = j.user;
  } catch {
    me.value = null;
  } finally {
    meLoading.value = false;
  }
}

export async function login(username, password) {
  const r = await fetch("http://localhost:3001/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error("Invalid credentials");
  const j = await r.json();
  me.value = j.user;
  return j.user;
}

export async function logout() {
  await fetch("http://localhost:3001/api/logout", {
    method: "POST",
    credentials: "include",
  });
  me.value = null;
}
