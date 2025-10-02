<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import { generateTeams, fullName, statsForTeams } from "../utils/teamGen.js";
import { withLoading, push as pushToast } from "../services/ui";
import { branding } from "../services/branding";
import * as XLSX from "xlsx";

type Gender = "Male" | "Female" | "Other";
type Attendee = {
  id: string;
  first_name: string;
  last_name: string;
  nickname?: string;
  congregation: string;
  gender: Gender;
  age: number;
  is_leader: boolean;
};
type Team = { id: string; name: string; members: Attendee[] };

// Live populations (fetched from backend)
const attendeesPool = ref<Attendee[]>([]);
const leadersPool = ref<Attendee[]>([]);
const teams = ref<Team[]>([]);
const isLoading = ref(false);
const preferredTeamCount = ref<number>(3);

const validation = ref("");
const reconcileInfo = ref({ redistributed: 0, teamsAffected: 0, when: "" });
const saveStatus = ref("");
const lastSavedAt = ref<string | null>(null);
const pendingUndos: Record<
  string,
  { timer: number | null; finalize: () => Promise<void> }
> = {};

// SSE handlers (module-scoped so we can add/remove them cleanly)
const onTeamsUpdated = async (ev: any) => {
  const payload = ev?.detail || {};
  const localDirty = lastSavedAt.value && lastSavedAt.value !== payload.saved_at;
  if (teams.value.length && localDirty) {
    pushToast({ type: 'info', title: 'Teams changed remotely', message: 'Teams were updated on another device.', actionLabel: 'Load', action: async () => { await loadTeamsFromServerSilent(); } });
    return;
  }
  await loadTeamsFromServerSilent();
};

const onTeamsCleared = async (ev: any) => {
  const payload = ev?.detail || {};
  const localDirty = lastSavedAt.value && lastSavedAt.value !== payload.saved_at;
  if (teams.value.length && localDirty) {
    pushToast({ type: 'info', title: 'Teams cleared remotely', message: 'Teams were cleared on another device.', actionLabel: 'Load', action: async () => { await loadTeamsFromServerSilent(); } });
    return;
  }
  await loadTeamsFromServerSilent();
};

// Confirmation wrapper for saving. Use confirm modal before performing the save.
function saveTeams() {
  openConfirm(
    "Save teams to server? This will overwrite saved teams on the server.",
    saveTeamsConfirmed
  );
}

async function saveTeamsConfirmed() {
  // Always persist locally first
  saveState();
  saveStatus.value = "Saving...";
  isLoading.value = true;
  try {
    // wrap in shared withLoading so UI service shows global overlay and queues toasts
    const res = await withLoading(async () => {
      const r = await fetch(`${API}/api/teams`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams: teams.value }),
      });
      if (!r.ok) throw new Error("Server save failed");
      const data = await r.json().catch(() => ({}));
      lastSavedAt.value = data?.saved_at || new Date().toISOString();
      pushToast({ type: "success", message: "Teams saved!", title: "Saved" });
      return data;
    }, "Saving teams…");
    return true;
  } catch (e) {
    console.error("Save teams failed", e);
    saveStatus.value = "Failed to save to server (network). Saved locally.";
    pushToast({
      type: "error",
      message: e?.message || "Failed to save teams",
      title: "Error",
    });
    return false;
  }
}

async function loadTeamsFromServerHandler() {
  // Show the confirm modal first; only fetch after the user confirms.
  openConfirm(
    "Load saved teams from server? This will replace current teams.",
    async () => {
      try {
        const data = await withLoading(async () => {
          const r = await fetch(`${API}/api/teams`, { credentials: "include" });
          if (!r.ok) throw new Error("Failed to load teams from server");
          return r.json().catch(() => ({}));
        }, "Loading saved teams…");

        const serverTeams = data?.teams || [];
        if (!serverTeams.length) {
          saveStatus.value = "No saved teams on server";
          pushToast({
            type: "info",
            message: "No saved teams on server",
            title: "No data",
          });
          return false;
        }

        // return current team members to pools (avoid duplicates)
        const allMembers = teams.value.flatMap((t) => t.members);
        allMembers.forEach((m) => {
          if (m.is_leader) {
            if (!leadersPool.value.some((x) => x.id === m.id))
              leadersPool.value.push(m);
          } else {
            if (!attendeesPool.value.some((x) => x.id === m.id))
              attendeesPool.value.push(m);
          }
        });

        // set teams and metadata
        teams.value = serverTeams.map((t: any) => ({
          id: t.id,
          name: t.name,
          members: (t.members || []).map((m: any) => ({ ...m })),
        }));
        lastSavedAt.value = data?.saved_at || lastSavedAt.value;
        saveStatus.value = `Loaded ${teams.value.length} teams from server`;
        pushToast({
          type: "info",
          message: `Loaded ${teams.value.length} teams`,
          title: "Loaded",
        });
      } catch (e) {
        console.error("Failed to load teams", e);
        saveStatus.value = "Failed to load teams from server";
        pushToast({
          type: "error",
          message: e?.message || "Failed to load teams",
          title: "Error",
        });
        return false;
      }
    }
  );
  return true;
}

// Silent loader used by cross-device sync (does not show confirm)
async function loadTeamsFromServerSilent() {
  try {
    const data = await withLoading(async () => {
      const r = await fetch(`${API}/api/teams`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load teams from server");
      return r.json().catch(() => ({}));
    }, "Loading saved teams…");

    const serverTeams = data?.teams || [];
    if (!serverTeams.length) {
      saveStatus.value = "No saved teams on server";
      return false;
    }

    // return current team members to pools (avoid duplicates)
    const allMembers = teams.value.flatMap((t) => t.members);
    allMembers.forEach((m) => {
      if (m.is_leader) {
        if (!leadersPool.value.some((x) => x.id === m.id)) leadersPool.value.push(m);
      } else {
        if (!attendeesPool.value.some((x) => x.id === m.id)) attendeesPool.value.push(m);
      }
    });

    teams.value = serverTeams.map((t: any) => ({ id: t.id, name: t.name, members: (t.members || []).map((m: any) => ({ ...m })) }));
    lastSavedAt.value = data?.saved_at || lastSavedAt.value;
    saveStatus.value = `Loaded ${teams.value.length} teams from server`;
    pushToast({ type: "info", message: `Loaded ${teams.value.length} teams`, title: "Loaded" });
    // ensure pools are stripped of assigned members
    stripAssignedFromPools(teams.value);
    return true;
  } catch (e) {
    console.error("Failed to load teams (silent)", e);
    return false;
  }
}

// Cross-device sync: poll server for teams and prompt user to load when changed
const _syncTimer = { id: null as number | null, lastSeen: null as string | null };
function startTeamsSync(intervalMs = 8000) {
  // only start one
  if (_syncTimer.id) return;
  _syncTimer.id = window.setInterval(async () => {
    try {
      const r = await fetch(`${API}/api/teams`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json().catch(() => ({}));
      const savedAt = data?.saved_at || null;
      if (!savedAt) return;
      // if we haven't seen this saved_at and it's newer than our current lastSavedAt
      if (_syncTimer.lastSeen !== savedAt && savedAt !== lastSavedAt.value) {
        // remember we've seen it so we don't spam
        _syncTimer.lastSeen = savedAt;
        // push a toast offering to load remote teams
        pushToast({
          type: "info",
          title: "Remote update",
          message: `Teams were saved by ${data.saved_by || 'another device'} at ${new Date(savedAt).toLocaleString()}`,
          actionLabel: "Load",
          action: async () => {
            await loadTeamsFromServerSilent();
          },
        });
      }
    } catch (e) {
      // ignore network hiccups
    }
  }, intervalMs) as unknown as number;
}

function stopTeamsSync() {
  if (_syncTimer.id) {
    clearInterval(_syncTimer.id);
    _syncTimer.id = null;
  }
}

async function resetPools() {
  // Re-fetch from backend and attempt to restore/preserve teams from persisted state.
  await fetchAttendees();
  // Try to restore persisted state (if present)
  loadState();

  // If we have existing teams and there are attendees in the pool,
  // distribute remaining attendees across the teams (round-robin).
  reconcileTeamsAfterRefresh();
}

// Confirmation wrapper for reset/refresh action. If there are teams, confirm first.
async function confirmResetPools() {
  if (teams.value.length) {
    openConfirm(
      "Refresh attendees will reload attendees and may redistribute members. Continue?",
      async () => {
        await withLoading(() => resetPools(), "Refreshing attendees…");
      }
    );
    return;
  }
  // No teams - safe to refresh without confirmation
  await withLoading(() => resetPools(), "Refreshing attendees…");
}

onMounted(async () => {
  await fetchAttendees();
  // ensure teams cleared
  // attempt to restore persisted state after we have fresh attendees (if any)
  // prefer server state if available, otherwise fallback to localStorage
  try {
    const r = await fetch(`${API}/api/teams`, { credentials: "include" });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      if (data?.teams) {
        teams.value = (data.teams || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          members: t.members || [],
        }));
        return;
      }
    }
  } catch (e) {
    // ignore and fall back
  }
  loadState();
  // start polling for cross-device changes
  startTeamsSync();
  // respond to realtime load requests from SSE service
  document.addEventListener('realtime:load-remote-teams', loadTeamsFromServerSilent);
  // auto-refresh when SSE notifies of team changes. If the user has local unsaved changes
  // we surface a toast offering to load remote teams instead of overwriting silently.
  const onTeamsUpdated = async (ev) => {
    const payload = ev?.detail || {};
    // if we have local edits since lastSavedAt, prompt user instead
    const localDirty = lastSavedAt.value && lastSavedAt.value !== payload.saved_at;
    if (teams.value.length && localDirty) {
      pushToast({ type: 'info', title: 'Teams changed remotely', message: 'Teams were updated on another device.', actionLabel: 'Load', action: async () => { await loadTeamsFromServerSilent(); } });
      return;
    }
    // no local teams or no local edits: auto-load silently
    await loadTeamsFromServerSilent();
  };
  const onTeamsCleared = async (ev) => {
    // similar flow for clears
    const payload = ev?.detail || {};
    const localDirty = lastSavedAt.value && lastSavedAt.value !== payload.saved_at;
    if (teams.value.length && localDirty) {
      pushToast({ type: 'info', title: 'Teams cleared remotely', message: 'Teams were cleared on another device.', actionLabel: 'Load', action: async () => { await loadTeamsFromServerSilent(); } });
      return;
    }
    await loadTeamsFromServerSilent();
  };
  document.addEventListener('realtime:teams:updated', onTeamsUpdated);
  document.addEventListener('realtime:teams:cleared', onTeamsCleared);
});

onUnmounted(() => {
  stopTeamsSync();
  document.removeEventListener('realtime:load-remote-teams', loadTeamsFromServerSilent);
  document.removeEventListener('realtime:teams:updated', onTeamsUpdated);
  document.removeEventListener('realtime:teams:cleared', onTeamsCleared);
});
const API = "";

const router = useRouter();

async function fetchAttendees() {
  isLoading.value = true;
  try {
    const r = await fetch(`${API}/api/campers`, { credentials: "include" });
    if (!r.ok) {
      if (r.status === 401) {
        validation.value = "Please log in to load attendees.";
        return;
      }
      console.error("Failed to fetch campers", r.status);
      validation.value = "Failed to load attendees.";
      return;
    }
    const data = await r.json().catch(() => ({}));
    const rows = data?.rows || [];
    attendeesPool.value = rows
      .filter((a: any) => !a.is_leader)
      .map((a: any) => ({ ...a }));
    leadersPool.value = rows
      .filter((a: any) => a.is_leader)
      .map((a: any) => ({ ...a }));
  } catch (e) {
    console.error("Failed to fetch campers", e);
  } finally {
    isLoading.value = false;
  }
}

async function generate() {
  validation.value = "";
  const N = Math.floor(preferredTeamCount.value || 0);
  if (N < 1) {
    validation.value = "Please enter a number greater than 0.";
    return;
  }

  // If there are existing teams, confirm regeneration first. If confirmed,
  // return members to pools and then generate. Otherwise, generate directly.
  if (teams.value.length) {
    openConfirm(
      "Regenerate teams? This will reset all current teams.",
      async () => {
        await withLoading(async () => {
          // return everyone (avoid duplicates)
          const allMembers = teams.value.flatMap((t) => t.members);
          allMembers.forEach((m) => {
            if (m.is_leader) {
              if (!leadersPool.value.some((x) => x.id === m.id))
                leadersPool.value.push(m);
            } else {
              if (!attendeesPool.value.some((x) => x.id === m.id))
                attendeesPool.value.push(m);
            }
          });
          teams.value = [];
          doGenerate(N);
        }, "Generating teams…");
      }
    );
    return;
  }

  await withLoading(() => doGenerate(N), "Generating teams…");
}

function doGenerate(N: number) {
  // Use pure generator
  const nonLeaders = attendeesPool.value.slice();
  // use strict parity to balance gender and age
  const gen = generateTeams(nonLeaders, N, { parity: 'strict' });

  // Create Team objects
  teams.value = gen.map((members, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    members,
  }));

  // Remove assigned members from attendeesPool
  const assignedIds = new Set(
    teams.value.flatMap((t) => t.members.map((m) => m.id))
  );
  attendeesPool.value = attendeesPool.value.filter(
    (a) => !assignedIds.has(a.id)
  );
}

// Remove any attendees/leaders that are currently assigned to teams from the
// available pools to keep counts accurate.
function stripAssignedFromPools(teamsList: Team[]) {
  const assigned = new Set(
    teamsList.flatMap((t) => t.members.map((m) => m.id))
  );
  attendeesPool.value = attendeesPool.value.filter((a) => !assigned.has(a.id));
  leadersPool.value = leadersPool.value.filter((l) => !assigned.has(l.id));
}

function reconcileTeamsAfterRefresh() {
  // If there are no teams, nothing to do
  if (!teams.value.length) return;

  let redistributed = 0;
  const touchedTeams = new Set<string>();

  let i = 0;
  while (attendeesPool.value.length) {
    const mem = attendeesPool.value.shift();
    if (!mem) break;
    const already = teams.value.some((t) =>
      t.members.some((m) => m.id === mem.id)
    );
    if (already) continue;
    const t = teams.value[i % teams.value.length];
    t.members.push(mem);
    redistributed++;
    touchedTeams.add(t.id);
    i++;
  }

  // Instead of naive round-robin above, prefer strict parity redistribution by
  // rebuilding non-leader teams from the full attendee pool so genders/ages are balanced.
  try {
    const teamCount = teams.value.length;
    // collect all non-leader attendees from pools + current teams
    const allNonLeaders = [
      ...attendeesPool.value.filter(a => !a.is_leader),
      ...teams.value.flatMap(t => (t.members || []).filter(m => !m.is_leader)),
    ];
    // generate balanced teams with strict parity
    const rebuilt = generateTeams(allNonLeaders, teamCount, { parity: 'strict' });
    // map rebuilt arrays back into team objects, preserving names/ids when possible
    const oldNames = teams.value.map(t => ({ id: t.id, name: t.name }));
    teams.value = rebuilt.map((members, idx) => ({
      id: oldNames[idx]?.id || `t${idx+1}`,
      name: oldNames[idx]?.name || `Team ${idx+1}`,
      members,
    }));
    // clear pools and then remove assigned members from newly built teams
    attendeesPool.value = [];
    stripAssignedFromPools(teams.value);
    redistributed = teams.value.flatMap(t => t.members).length;
    touchedTeams.clear();
    teams.value.forEach(t => touchedTeams.add(t.id));
  } catch (e) {
    // if something goes wrong, fall back to previous behavior (already applied above)
    console.error('Failed to rebuild teams with strict parity', e);
  }

  reconcileInfo.value = {
    redistributed,
    teamsAffected: touchedTeams.size,
    when: redistributed ? new Date().toISOString() : "",
  };

  if (redistributed) {
    const when = reconcileInfo.value.when;
    pushToast({
      type: "info",
      title: "Redistributed",
      message: `Redistributed ${redistributed} attendees into ${
        touchedTeams.size
      } teams on ${new Date(when).toLocaleString()}`,
    });
  } else {
    pushToast({
      type: "error",
      title: "Redistributed",
      message: `Nothing to Redistributed`,
    });
  }

  // best-effort save to server
  (async () => {
    try {
      await fetch(`${API}/api/teams`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams: teams.value }),
      });
    } catch (e) {
      /* ignore */
    }
  })();
}

function renameTeam(teamId: string, name: string) {
  const t = teams.value.find((x) => x.id === teamId);
  if (t) t.name = name;
}

function deleteTeam(teamId: string) {
  const tIdx = teams.value.findIndex((x) => x.id === teamId);
  if (tIdx === -1) return;
  const prev = JSON.parse(JSON.stringify(teams.value));
  const t = teams.value[tIdx];
  openConfirm("Delete this team? Members will return to the pool.", () => {
    // optimistic remove and allow undo
    teams.value.splice(tIdx, 1);
    const toastId = pushToast({
      type: "info",
      message: `Deleted ${t.name}`,
      title: "Deleted",
      actionLabel: "Undo",
      action: () => {
        teams.value = prev;
      },
    });
    // finalize after 5s: resync pools
    const timer = window.setTimeout(async () => {
      try {
        await fetchAttendees();
      } catch (e) {}
      stripAssignedFromPools(teams.value);
      // no explicit removal of toast since ui handles expiry
      delete pendingUndos[toastId as any];
    }, 5000);
    pendingUndos[toastId as any] = { timer, finalize: async () => {} };
  });
}

// Confirm modal state
const confirmOpen = ref(false);
const confirmMessage = ref("");
let confirmResolve: (() => void) | null = null;

function openConfirm(message: string, onConfirm: () => void) {
  confirmMessage.value = message;
  confirmOpen.value = true;
  nextTick(() => {
    const el = document.getElementById("confirmOk");
    el && el.focus();
  });
  confirmResolve = onConfirm;
}

function closeConfirm() {
  confirmOpen.value = false;
  confirmMessage.value = "";
  confirmResolve = null;
}

function confirmOk() {
  if (confirmResolve) {
    confirmResolve();
  }
  closeConfirm();
}

const availableLeaders = computed(() =>
  leadersPool.value.filter(
    (l) => !teams.value.some((t) => t.members.some((m) => m.id === l.id))
  )
);

function assignLeaderToTeam(leaderId: string, teamId: string) {
  if (!teamId) return;
  const leader = leadersPool.value.find((l) => l.id === leaderId);
  const team = teams.value.find((t) => t.id === teamId);
  if (!leader || !team) return;
  openConfirm(
    `Assign ${leader.first_name} ${leader.last_name} to ${team.name}?`,
    () => {
      const idx = leadersPool.value.findIndex((x) => x.id === leaderId);
      if (idx !== -1) {
        const l = leadersPool.value.splice(idx, 1)[0];
        team.members.push(l);
        stripAssignedFromPools(teams.value);
      }
    }
  );
}

function removeMemberFromTeam(teamId: string, memberId: string) {
  const t = teams.value.find((x) => x.id === teamId);
  if (!t) return;
  const prev = JSON.parse(JSON.stringify(teams.value));
  const idx = t.members.findIndex((m) => m.id === memberId);
  if (idx === -1) return;
  const [m] = t.members.splice(idx, 1);
  // optimistic move into pools; avoid duplicates (finalization will re-sync)
  if (m.is_leader) {
    if (!leadersPool.value.some((x) => x.id === m.id))
      leadersPool.value.push(m);
  } else {
    if (!attendeesPool.value.some((x) => x.id === m.id))
      attendeesPool.value.push(m);
  }
  const toastId = pushToast({
    type: "info",
    message: `Removed ${m.first_name} ${m.last_name}`,
    title: "Removed",
    actionLabel: "Undo",
    action: () => {
      teams.value = prev;
    },
  });
  const timer = window.setTimeout(async () => {
    try {
      await fetchAttendees();
    } catch (e) {}
    stripAssignedFromPools(teams.value);
    delete pendingUndos[toastId as any];
  }, 5000);
  pendingUndos[toastId as any] = { timer, finalize: async () => {} };
}

// Confirm before removing a member from a team
function confirmRemoveMember(teamId: string, memberId: string) {
  openConfirm("Remove this member from the team?", () => {
    removeMemberFromTeam(teamId, memberId);
  });
}

// Persistence: save teams and pools to localStorage so state survives refresh
const STORAGE_KEY = "teamgen_state_v1";
function saveState() {
  try {
    const payload = {
      teams: teams.value,
      attendeesPool: attendeesPool.value,
      leadersPool: leadersPool.value,
      preferredTeamCount: preferredTeamCount.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.error("Failed to save state", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed) return;
    // Reconcile loaded pools with freshly fetched attendees to avoid stale entries
    const freshIds = new Set([
      ...attendeesPool.value.map((a) => a.id),
      ...leadersPool.value.map((a) => a.id),
    ]);
    // Restore pools and teams only for attendees that still exist locally
    attendeesPool.value = (parsed.attendeesPool || [])
      .filter((a: any) => !freshIds.has(a.id))
      .concat(attendeesPool.value);
    leadersPool.value = (parsed.leadersPool || [])
      .filter((a: any) => !freshIds.has(a.id))
      .concat(leadersPool.value);
    teams.value = (parsed.teams || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      members: t.members.filter((m: any) => true),
    }));
    preferredTeamCount.value =
      parsed.preferredTeamCount || preferredTeamCount.value;
  } catch (e) {
    console.error("Failed to load state", e);
  }
}

// Persist whenever key state changes
watch(
  [teams, attendeesPool, leadersPool, preferredTeamCount],
  () => {
    saveState();
  },
  { deep: true }
);

// (modal removed) filteredModalLeaders removed

// Helpers
const totalTeams = computed(() => teams.value.length);
const unassignedCount = computed(() => {
  const assignedIds = new Set(
    teams.value.flatMap((t) => t.members.map((m) => m.id))
  );
  return attendeesPool.value.filter((a) => !assignedIds.has(a.id)).length;
});

function teamStats(team: Team) {
  const s = statsForTeams([team.members])[0];
  // normalize genders string
  const g = s.genders || {};
  const gendersStr = `M:${g.Male || 0} F:${g.Female || 0} O:${g.Other || 0}`;
  return { count: s.count, avgAge: Math.round(s.avgAge * 10)/10, gendersStr };
}

function toSafeFilename(s: string) {
  return String(s || "file")
    .normalize("NFKD")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-{2,}/g, "-")
    .slice(0, 120)
    .replace(/^[_-]+|[_-]+$/g, "");
}

function exportTeams() {
  try {
    const wb = XLSX.utils.book_new();
    teams.value.forEach((t) => {
      const rows = (t.members || []).map((m) => ({
        Name: `${m.first_name} ${m.last_name}`,
        Congregation: m.congregation || "",
        Nickname: m.nickname || "",
        Gender: m.gender || "",
        Age: m.age || "",
        IsLeader: m.is_leader ? "Yes" : "No",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const sheetName =
        toSafeFilename(t.name || `team-${t.id}`).slice(0, 31) || `Sheet${t.id}`;
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    });

    const appName = branding.activityName?.value || "app";
    const fileName = `${toSafeFilename(appName)}-teams-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pushToast({
      type: "success",
      message: `Exported ${teams.value.length} teams`,
      title: "Export",
    });
  } catch (e) {
    console.error("Export failed", e);
    pushToast({
      type: "error",
      message: (e as any)?.message || "Export failed",
      title: "Error",
    });
  }
}
</script>

<template>
  <div class="min-h-[calc(100vh-4rem)] bg-gray-50 py-8">
    <section class="mx-auto max-w-[100rem] px-4">
      <header class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 tracking-tight">
            Team Generator
          </h1>
          <p class="mt-1 text-sm text-gray-500">
            Manage attendee groupings for activities.
          </p>
        </div>
      </header>
      <div class="flex gap-4">
        <div class="mb-6 flex justify-between items-start w-full">
          <div class="flex gap-4 items-end">
            <div
              class="flex flex-col p-4 rounded-lg border border-emerald-300 bg-white text-xs font-medium text-emerald-700 shadow-sm w-48"
            >
              <div
                class="text-xs font-medium text-emerald-700 uppercase tracking-wider"
              >
                Total Teams
              </div>
              <div class="mt-1 text-3xl font-normal text-gray-800">{{ totalTeams }}</div>
            </div>
            <div
              class="flex flex-col p-4 rounded-lg border border-indigo-300 bg-white text-xs font-medium text-indigo-700 shadow-sm w-48"
            >
              <div
                class="text-xs font-medium text-indigo-700 uppercase tracking-wider"
              >
                Unassigned Attendees
              </div>
              <div class="mt-1 text-3xl font-normal text-gray-800">{{ unassignedCount }}</div>
            </div>
          </div>

          <div class="flex flex-col gap-4 items-end">
            <div class="flex gap-3">
              <label class="flex gap-3 text-md items-center">
                <span>Preferred number of teams:</span>
                <input
                  v-model.number="preferredTeamCount"
                  type="number"
                  min="1"
                  class="border px-2 py-1 rounded w-28 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
                />
              </label>

              <button
                @click="generate"
                class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 transition"
              >
                Generate Teams
              </button>
            </div>
            <div class="flex gap-3">
              <!-- Secondary -->
              <button
                @click="confirmResetPools"
                class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                Re-Assign Attendees
              </button>

              <!-- Secondary + Disabled -->
              <button
                @click="saveTeams"
                class="inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                Save Teams
              </button>

              <!-- Secondary -->
              <button
                @click="loadTeamsFromServerHandler"
                class="inline-flex items-center justify-center rounded-lg border border-indigo-300 bg-white px-4 py-2.5 text-sm font-medium text-indigo-700 shadow-sm transition hover:bg-indigo-50"
              >
                Load Saved Teams
              </button>

              <!-- Secondary -->
              <button
                @click="exportTeams"
                class="inline-flex items-center justify-center rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-green-700"
              >
                Export Teams
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="saveStatus" class="mb-2 text-sm text-gray-600">
        {{ saveStatus }}
      </div>
      <div
        v-if="validation"
        class="mb-4 p-3 bg-yellow-50 border rounded text-sm"
      >
        <div>{{ validation }}</div>
        <div v-if="validation.includes('log in')" class="mt-2">
          <button
            @click="router.push('/login')"
            class="px-3 py-1 bg-indigo-600 text-white rounded"
          >
            Go to Login
          </button>
        </div>
      </div>

      <div class="grid gap-4 grid-cols-1 lg:grid-cols-4">
        <!-- Leaders panel -->
        <aside class="col-span-1">
          <div class="border rounded p-3 bg-white sticky top-6">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-semibold">Leaders</h3>
              <span class="text-sm text-gray-500">{{
                availableLeaders.length
              }}</span>
            </div>
            <div class="space-y-2">
              <template v-if="availableLeaders.length === 0">
                <div class="text-sm text-gray-500">No available leaders</div>
              </template>
              <template v-else>
                <div
                  v-for="l in availableLeaders"
                  :key="l.id"
                  class="flex items-center justify-between"
                >
                  <div class="flex items-center gap-3">
                    <div
                      class="uppercase w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-sm font-semibold"
                    >
                      {{ (l.first_name || "").charAt(0)
                      }}{{ (l.last_name || "").charAt(0) }}
                    </div>
                    <div>
                      <div class="text-sm font-medium capitalize ">
                        {{ l.first_name }} {{ l.last_name }}
                      </div>
                      <div class="text-xs text-gray-500">
                        {{ l.congregation }} • {{ l.age }} • {{ l.gender }}
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <select
                      v-if="teams.length"
                      class="text-xs border px-2 py-1 rounded"
                      @change="assignLeaderToTeam(l.id, $event.target.value)"
                    >
                      <option value="">Assign…</option>
                      <option v-for="t in teams" :key="t.id" :value="t.id">
                        {{ t.name }}
                      </option>
                    </select>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </aside>

        <div class="col-span-3">
          <div
            v-for="team in teams"
            :key="team.id"
            class="border rounded p-3 bg-white mb-4"
          >
            <div class="flex items-center gap-2 mb-2">
              <input
                v-model="team.name"
                class="flex-1 border px-2 py-1 rounded focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none"
                aria-label="Team name"
              />
              <button
                @click="deleteTeam(team.id)"
                class="px-2 py-1 bg-red-500 text-white rounded"
                aria-label="Delete team {{team.name}}"
              >
                Delete team
              </button>
            </div>
            <table class="w-full table-auto">
              <thead class="text-left text-xs text-gray-600">
                <tr>
                  <th class="py-2">Name</th>
                  <th class="py-2">Congregation</th>
                  <th class="py-2">Nickname</th>
                  <th class="py-2">Gender</th>
                  <th class="py-2">Age</th>
                  <th class="py-2">Option</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in team.members" :key="m.id" class="border-t">
                  <td class="py-3">
                    <div class="flex items-center gap-3">
                      <div
                        class="uppercase w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                      >
                        {{ (m.first_name || "").charAt(0)
                        }}{{ (m.last_name || "").charAt(0) }}
                      </div>
                      <div class="font-medium capitalize">{{ m.first_name }} {{ m.last_name }}</div>
                    </div>
                  </td>
                  <td class="py-3 capitalize">{{ m.congregation }}</td>
                  <td class="py-3 capitalize">{{ m.nickname }}</td>
                  <td class="py-3">{{ m.gender }}</td>
                  <td class="py-3">{{ m.age }}</td>
                  <td class="py-3">
                    <button
                      @click="confirmRemoveMember(team.id, m.id)"
                      class="text-xs text-red-600"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot class="text-xs text-gray-600">
                <tr>
                  <td colspan="6" class="py-2">
                    <div class="flex items-center justify-between">
                      <div>Count: {{ team.members.length }}</div>
                      <div class="text-sm text-gray-500">Avg age: {{ teamStats(team).avgAge }}</div>
                      <div class="text-sm text-gray-500">Genders: {{ teamStats(team).gendersStr }}</div>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <!-- modal removed per UX change: leaders are assigned via dropdowns -->

      <!-- Confirm modal -->
      <div
        v-if="confirmOpen"
        class="fixed inset-0 bg-black/50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmTitle"
      >
        <div
          class="bg-white p-4 rounded w-full max-w-md"
          @keydown.esc="closeConfirm"
        >
          <h3 id="confirmTitle" class="font-semibold mb-2">Confirm</h3>
          <div class="mb-4">{{ confirmMessage }}</div>
          <div class="flex justify-end gap-2">
            <button
              id="confirmCancel"
              @click="closeConfirm"
              class="px-3 py-1 border rounded"
            >
              Cancel
            </button>
            <button
              id="confirmOk"
              @click="confirmOk"
              class="px-3 py-1 bg-red-600 text-white rounded"
            >
              OK
            </button>
          </div>
        </div>
      </div>
      <div class="mt-6 text-sm text-gray-600">
        Note: Leaders are not auto-assigned. Regenerate clears existing teams.
      </div>
    </section>
  </div>
  <!-- Global LoadingOverlay and ToastShelf are mounted in App.vue -->
</template>

<style scoped>
/* minimal styling */
body {
  font-family: Inter, system-ui, Arial;
}
</style>
