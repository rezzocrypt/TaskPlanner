import { ref, reactive, computed } from "vue";
import { startOfWeek } from "../utils/date";
import { sourceColor } from "../utils/colors";
import { api } from "../utils/api";
import { getUid } from "../utils/user";

const ATTACHED_KEY_PREFIX = "weekplan-attached-shares-v";

const lists = ref([]);
const selectedIds = ref([]);
const metas = reactive({});
const weekStart = ref(startOfWeek(new Date()));
const error = ref("");
const state = reactive({});
const colors = reactive({});
const shares = reactive({});
const ownerStates = reactive({});
const shareColors = reactive({});

const attachedShares = ref(loadAttachedShares());
let uid = null;

const visibleLists = computed(() =>
  selectedIds.value.map((id) => metas[id]).filter(Boolean)
);

function loadAttachedShares() {
  try {
    const raw = localStorage.getItem(ATTACHED_KEY_PREFIX);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function persistAttached() {
  try {
    localStorage.setItem(ATTACHED_KEY_PREFIX, JSON.stringify(attachedShares.value));
  } catch (e) {}
}

function isReadonly(id) {
  const item = lists.value.find((l) => l.id === id);
  return !!(item && item.readonly);
}

function effectiveColor(id) {
  if (colors[id]) return colors[id];
  if (shareColors[id]) return shareColors[id];
  return sourceColor(colorIndex(id));
}

function colorIndex(id) {
  const pos = lists.value.findIndex((l) => l.id === id);
  return pos < 0 ? 0 : pos;
}

function taskId(task) {
  return task && typeof task === "object" ? task.id : null;
}

function checkedAt(dayKey, listId, task) {
  const id = taskId(task);
  if (id == null) return false;
  const item = lists.value.find((l) => l.id === listId);
  if (item && item.shareRef) {
    const os = item.shareRef.ownerId === uid ? state : ownerStates[item.shareRef.ownerId];
    return !!(os && os[dayKey] && os[dayKey][id]);
  }
  return !!(state[dayKey] && state[dayKey][id]);
}

function isDone(dateKey, task) {
  const id = taskId(task);
  if (id == null) return false;
  return !!(state[dateKey] && state[dateKey][id]);
}

async function toggle(dateKey, listId, task, checked) {
  const id = taskId(task);
  if (id == null) return;
  if (!state[dateKey]) state[dateKey] = {};
  if (checked) state[dateKey][id] = true;
  else delete state[dateKey][id];
  try {
    await api("/state/toggle", {
      method: "POST",
      body: { day: dateKey, taskId: id, done: checked }
    });
  } catch (e) {
    console.error("toggle save failed", e);
  }
}

async function loadState() {
  try {
    const data = await api("/state");
    const obj = (data && data.state) || {};
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, obj);
  } catch (e) {
    console.error("load state failed", e);
  }
}

async function loadAllMetas() {
  await Promise.all(
    lists.value.map(async (item) => {
      try {
        const meta = await api("/lists/" + encodeURIComponent(item.id));
        metas[item.id] = {
          id: meta.id,
          label: meta.name,
          tasks: meta.tasks
        };
        item.label = meta.name;
        if (meta.color) colors[item.id] = meta.color;
        else delete colors[item.id];
      } catch (e) {
        console.error("load meta failed", item.id, e);
      }
    })
  );
}

async function loadLists() {
  try {
    uid = await getUid();
    const data = await api("/lists");
    const rows = data.lists || [];
    lists.value = rows.map((r) => ({
      id: r.id,
      label: r.label,
      readonly: false,
      token: r.token || ""
    }));
    for (const r of rows) {
      if (r.token) shares[r.id] = r.token;
      else delete shares[r.id];
    }
    await loadAllMetas();
    await loadState();
    selectedIds.value = lists.value.map((l) => l.id);
    for (const t of attachedShares.value) {
      await attachShared(t);
    }
    error.value = "";
    startSharedPolling();
  } catch (e) {
    error.value = "Не удалось загрузить данные. Запустите сервер: <code>npm start</code>";
    console.error(e);
  }
}

async function setColor(id, hex) {
  const prev = colors[id] || "";
  colors[id] = hex;
  try {
    await api("/lists/" + encodeURIComponent(id) + "/color", {
      method: "PUT",
      body: { color: hex }
    });
  } catch (e) {
    if (prev) colors[id] = prev;
    else delete colors[id];
  }
}

async function resetColor(id) {
  delete colors[id];
  try {
    await api("/lists/" + encodeURIComponent(id) + "/color", {
      method: "PUT",
      body: { color: "" }
    });
  } catch (e) {}
}

async function shareList(id) {
  const item = lists.value.find((l) => l.id === id);
  if (!item || item.readonly) throw new Error("Список не найден");
  const data = await api("/shares", { method: "POST", body: { listId: id } });
  shares[id] = data.token;
  const url = location.origin + location.pathname + "?share=" + data.token;
  return { url, token: data.token };
}

async function revokeShare(id) {
  try {
    await api("/shares/" + encodeURIComponent(id), { method: "DELETE" });
  } catch (e) {}
  delete shares[id];
}

function tokenFromId(id) {
  return String(id).replace(/^shared\//, "");
}

async function fetchShareMeta(token) {
  try {
    return await api("/shares/" + encodeURIComponent(token));
  } catch (e) {
    return null;
  }
}

async function attachShared(token) {
  const clean = String(token || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) return;
  const id = "shared/" + clean;
  if (!attachedShares.value.includes(clean)) {
    attachedShares.value = [...attachedShares.value, clean];
    persistAttached();
  }
  if (lists.value.some((l) => l.id === id)) return;
  const meta = await fetchShareMeta(clean);
  if (!meta) {
    attachedShares.value = attachedShares.value.filter((t) => t !== clean);
    persistAttached();
    return;
  }
  metas[id] = { id, label: meta.name, tasks: meta.tasks };
  const item = { id, label: meta.name, readonly: true, shareRef: { ownerId: String(meta.owner) } };
  if (meta.color) shareColors[id] = meta.color;
  else delete shareColors[id];
  lists.value = [item, ...lists.value];
  selectedIds.value = [...new Set([id, ...selectedIds.value])];
  if (item.shareRef.ownerId && item.shareRef.ownerId !== uid) await loadOwnerState(item.shareRef.ownerId);
}

function detachShared(item, token) {
  attachedShares.value = attachedShares.value.filter((t) => t !== token);
  persistAttached();
  lists.value = lists.value.filter((l) => l.id !== item.id);
  selectedIds.value = selectedIds.value.filter((x) => x !== item.id);
  delete metas[item.id];
  delete shareColors[item.id];
}

function unsubscribe(id) {
  const item = lists.value.find((l) => l.id === id && l.readonly);
  if (!item) return;
  detachShared(item, tokenFromId(id));
}

async function loadOwnerState(ownerId) {
  if (!ownerId || ownerId === uid) return;
  try {
    const data = await api("/users/" + encodeURIComponent(ownerId) + "/state");
    if (data && data.state && typeof data.state === "object") {
      ownerStates[ownerId] = data.state;
    }
  } catch (e) {}
}

let sharedPollTimer = null;

function startSharedPolling() {
  if (sharedPollTimer) return;
  sharedPollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    refreshSharedLists();
  }, 5000);
}

async function refreshSharedLists() {
  const shared = lists.value.filter((l) => l.readonly);
  const fetchedOwners = new Set();
  for (const item of shared) {
    const token = tokenFromId(item.id);
    if (!token) continue;
    const meta = await fetchShareMeta(token);
    if (!meta) {
      detachShared(item, token);
      continue;
    }
    metas[item.id] = { id: item.id, label: meta.name, tasks: meta.tasks };
    item.label = meta.name;
    item.shareRef = { ownerId: String(meta.owner) };
    if (meta.color) shareColors[item.id] = meta.color;
    else delete shareColors[item.id];
    if (item.shareRef.ownerId && item.shareRef.ownerId !== uid && !fetchedOwners.has(item.shareRef.ownerId)) {
      fetchedOwners.add(item.shareRef.ownerId);
      await loadOwnerState(item.shareRef.ownerId);
    }
  }
}

async function saveList(id, data) {
  const meta = await api("/lists/" + encodeURIComponent(id), {
    method: "PUT",
    body: data
  });
  metas[id] = { id: meta.id, label: meta.name, tasks: meta.tasks };
  const item = lists.value.find((l) => l.id === id);
  if (item) item.label = meta.name;
}

async function addList(data) {
  const meta = await api("/lists", { method: "POST", body: data });
  metas[meta.id] = { id: meta.id, label: meta.name, tasks: meta.tasks };
  const shared = lists.value.filter((l) => l.readonly);
  const own = lists.value.filter((l) => !l.readonly);
  own.push({ id: meta.id, label: meta.name, readonly: false });
  lists.value = [...shared, ...own];
  selectedIds.value = [...new Set([...selectedIds.value, meta.id])];
}

async function deleteList(id) {
  if (!lists.value.some((l) => l.id === id)) return;
  await api("/lists/" + encodeURIComponent(id), { method: "DELETE" });
  lists.value = lists.value.filter((l) => l.id !== id);
  selectedIds.value = selectedIds.value.filter((x) => x !== id);
  delete metas[id];
  delete colors[id];
  delete shares[id];
}

function buildBackup() {
  return {
    app: "weekplan",
    version: 2,
    createdAt: new Date().toISOString(),
    lists: lists.value.filter((l) => !l.readonly).map((l) => {
      const meta = metas[l.id];
      return {
        id: l.id,
        name: meta ? meta.label : "",
        tasks: (meta ? meta.tasks : []).map((t) => ({
          id: t.id,
          text: t.text,
          start: t.start || "",
          end: t.end || "",
          days: Array.isArray(t.days) ? t.days.slice() : []
        }))
      };
    }),
    dayState: JSON.parse(JSON.stringify(state)),
    colors: JSON.parse(JSON.stringify(colors))
  };
}

async function restoreBackup(data) {
  await api("/restore", { method: "POST", body: data });
  lists.value = [];
  selectedIds.value = [];
  for (const k of Object.keys(metas)) delete metas[k];
  for (const k of Object.keys(colors)) delete colors[k];
  for (const k of Object.keys(shares)) delete shares[k];
  for (const k of Object.keys(ownerStates)) delete ownerStates[k];
  for (const k of Object.keys(shareColors)) delete shareColors[k];
  await loadLists();
}

function toggleList(id) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

function isSelected(id) {
  return selectedIds.value.includes(id);
}

function prevWeek() {
  weekStart.value = new Date(weekStart.value.getFullYear(), weekStart.value.getMonth(), weekStart.value.getDate() - 7);
}

function nextWeek() {
  weekStart.value = new Date(weekStart.value.getFullYear(), weekStart.value.getMonth(), weekStart.value.getDate() + 7);
}

function goToday() {
  weekStart.value = startOfWeek(new Date());
}

export function useTasks() {
  return {
    lists,
    selectedIds,
    metas,
    visibleLists,
    weekStart,
    error,
    state,
    colors,
    setColor,
    resetColor,
    effectiveColor,
    shares,
    shareList,
    revokeShare,
    attachShared,
    unsubscribe,
    checkedAt,
    isReadonly,
    loadLists,
    saveList,
    addList,
    deleteList,
    buildBackup,
    restoreBackup,
    toggleList,
    isSelected,
    isDone,
    toggle,
    prevWeek,
    nextWeek,
    goToday
  };
}