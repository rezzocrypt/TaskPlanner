import { ref, reactive, computed } from "vue";
import { startOfWeek } from "../utils/date";
import { sourceColor } from "../utils/colors";
import { getUid, randomToken } from "../utils/user";

const uid = getUid();
const USER_DIR = "users/" + uid;
const USER_MANIFEST = USER_DIR + "/manifest.json";
const STATE_FILE = USER_DIR + "/state.json";
const ROOT_MANIFEST = "manifest.json";
const STORAGE_KEY = "weekplan-" + uid + "-day-state-v1";
const COLORS_KEY = "weekplan-" + uid + "-source-colors-v1";
const SHARES_KEY = "weekplan-" + uid + "-shares-v1";
const ATTACHED_KEY = "weekplan-" + uid + "-attached-shares-v1";
const LEGACY_STATE_KEY = "weekplan-day-state-v1";
const LEGACY_COLORS_KEY = "weekplan-source-colors-v1";

function filePath(id) {
  return USER_DIR + "/" + id;
}

function slugLabel(id) {
  return String(id).split("/").pop().replace(/\.json$/i, "");
}

const lists = ref([]);
const selectedIds = ref([]);
const metas = reactive({});
const weekStart = ref(startOfWeek(new Date()));
const error = ref("");
const state = reactive(loadState());
const colors = reactive(loadColors());
const shares = reactive(loadShares());
const ownerStates = reactive({});
const shareColors = reactive({});

const visibleLists = computed(() =>
  selectedIds.value.map((id) => metas[id]).filter(Boolean)
);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
}

function loadColors() {
  try {
    const raw = localStorage.getItem(COLORS_KEY) || localStorage.getItem(LEGACY_COLORS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function persistColors() {
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
  } catch (e) {}
}

function loadShares() {
  try {
    const raw = localStorage.getItem(SHARES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function persistShares() {
  try {
    localStorage.setItem(SHARES_KEY, JSON.stringify(shares));
  } catch (e) {}
}

const attachedShares = ref(loadAttachedShares());

function loadAttachedShares() {
  try {
    const raw = localStorage.getItem(ATTACHED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function persistAttached() {
  try {
    localStorage.setItem(ATTACHED_KEY, JSON.stringify(attachedShares.value));
  } catch (e) {}
}

function shareMetaJSON(id) {
  return JSON.stringify({ owner: uid, list: id, color: colors[id] || "" }, null, 2);
}

async function shareList(id) {
  const list = lists.value.find((l) => l.id === id);
  if (!list || !metas[id]) throw new Error("Список не найден");
  let token = shares[id];
  if (!token) {
    token = randomToken();
    shares[id] = token;
    persistShares();
  }
  const content = sharedContentFor(id);
  await saveFile("shared/" + token + ".json", content);
  await saveFile("shared/" + token + ".meta.json", shareMetaJSON(id));
  metas[id] = buildMeta(id, content);
  const url = location.origin + location.pathname + "?share=" + token;
  return { url, token };
}

async function revokeShare(id) {
  const token = shares[id];
  if (!token) return;
  try {
    await deleteFile("shared/" + token + ".json");
    await deleteFile("shared/" + token + ".meta.json");
  } catch (e) {}
  delete shares[id];
  persistShares();
}

async function attachShared(token) {
  const clean = String(token || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) return;
  if (!attachedShares.value.includes(clean)) {
    attachedShares.value = [...attachedShares.value, clean];
    persistAttached();
  }
  const id = "shared/" + clean + ".json";
  if (lists.value.some((l) => l.id === id)) return;
  try {
    const r = await fetch(id);
    if (!r.ok) {
      attachedShares.value = attachedShares.value.filter((t) => t !== clean);
      persistAttached();
      return;
    }
    const text = await r.text();
    let parsed = false;
    try {
      JSON.parse(text);
      parsed = true;
    } catch (e) {}
    if (!parsed) {
      attachedShares.value = attachedShares.value.filter((t) => t !== clean);
      persistAttached();
      return;
    }
    metas[id] = buildMeta(id, text);
    const item = { id, label: metas[id].label, readonly: true };
    const meta = await fetchShareMeta(clean);
    if (meta) {
      item.shareRef = meta;
      if (meta.color) shareColors[id] = meta.color;
      else delete shareColors[id];
    }
    lists.value = [item, ...lists.value];
    selectedIds.value = [...new Set([id, ...selectedIds.value])];
    if (item.shareRef) await loadOwnerState(item);
  } catch (e) {}
}

async function fetchShareMeta(token) {
  try {
    const r = await fetch("shared/" + token + ".meta.json");
    if (!r.ok) return null;
    const meta = JSON.parse(await r.text());
    if (meta && typeof meta.owner === "string" && typeof meta.list === "string") {
      return {
        uid: meta.owner.replace(/[^a-zA-Z0-9_-]/g, ""),
        list: meta.list.split("/").pop(),
        color: typeof meta.color === "string" ? meta.color : ""
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function loadOwnerState(item) {
  if (!item.shareRef) return;
  const ownerUid = item.shareRef.uid;
  if (ownerUid === uid) return;
  try {
    const r = await fetch("users/" + ownerUid + "/state.json");
    if (!r.ok) return;
    const obj = JSON.parse(await r.text());
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      ownerStates[ownerUid] = obj;
    }
  } catch (e) {}
}

function checkedAt(dayKey, listId, text) {
  const item = lists.value.find((l) => l.id === listId);
  if (item && item.shareRef) {
    const os = item.shareRef.uid === uid ? state : ownerStates[item.shareRef.uid];
    return !!(os && os[dayKey] && os[dayKey][item.shareRef.list] && os[dayKey][item.shareRef.list][text]);
  }
  return !!(state[dayKey] && state[dayKey][listId] && state[dayKey][listId][text]);
}

function isReadonly(id) {
  const item = lists.value.find((l) => l.id === id);
  return !!(item && item.readonly);
}

let sharedPollTimer = null;

function startSharedPolling() {
  if (sharedPollTimer) return;
  sharedPollTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    refreshSharedLists();
  }, 5000);
}

function detachShared(item, token) {
  attachedShares.value = attachedShares.value.filter((t) => t !== token);
  persistAttached();
  lists.value = lists.value.filter((l) => l.id !== item.id);
  selectedIds.value = selectedIds.value.filter((x) => x !== item.id);
  delete metas[item.id];
}

function unsubscribe(id) {
  const item = lists.value.find((l) => l.id === id && l.readonly);
  if (!item) return;
  const token = String(id).replace(/^shared\//, "").replace(/\.json$/, "");
  detachShared(item, token);
}

async function refreshSharedLists() {
  const shared = lists.value.filter((l) => l.readonly);
  const fetchedOwners = new Set();
  for (const item of shared) {
    const token = String(item.id).replace(/^shared\//, "").replace(/\.json$/, "");
    if (!token) continue;
    try {
      const r = await fetch(item.id);
      const text = r.ok ? await r.text() : "";
      try {
        JSON.parse(text);
      } catch (e) {
        detachShared(item, token);
        continue;
      }
      metas[item.id] = buildMeta(item.id, text);
      item.label = metas[item.id].label;
      const meta = await fetchShareMeta(token);
      if (meta) {
        item.shareRef = meta;
        if (meta.color) shareColors[item.id] = meta.color;
        else delete shareColors[item.id];
      }
      if (item.shareRef && item.shareRef.uid !== uid && !fetchedOwners.has(item.shareRef.uid)) {
        fetchedOwners.add(item.shareRef.uid);
        await loadOwnerState(item);
      }
    } catch (e) {}
  }
}

function setColor(id, hex) {
  colors[id] = hex;
  persistColors();
  if (shares[id]) {
    try {
      saveFile("shared/" + shares[id] + ".meta.json", shareMetaJSON(id));
    } catch (e) {}
  }
}

function resetColor(id) {
  delete colors[id];
  persistColors();
  if (shares[id]) {
    try {
      saveFile("shared/" + shares[id] + ".meta.json", shareMetaJSON(id));
    } catch (e) {}
  }
}

function colorIndex(id) {
  const pos = lists.value.findIndex((l) => l.id === id);
  return pos < 0 ? 0 : pos;
}

function effectiveColor(id) {
  if (colors[id]) return colors[id];
  if (shareColors[id]) return shareColors[id];
  return sourceColor(colorIndex(id));
}

async function loadLists() {
  let manifestOk = false;
  try {
    const r = await fetch(USER_MANIFEST);
    if (r.ok) {
      manifestOk = true;
      const data = await r.json();
      lists.value = normalizeManifest(data);
    } else if (!(await seedFromRoot())) {
      error.value =
        "Не найден ваш manifest (<b>" + USER_MANIFEST + "</b>). Откройте страницу через локальный сервер: <code>npm run dev</code>, затем <code>http://localhost:5173</code>.";
      lists.value = [{ id: "tasks.json", label: "tasks" }];
      selectedIds.value = lists.value.map((l) => l.id);
      await cleanupBrokenLists(false, true);
      return;
    }
    const failed = await loadAllMetas();
    selectedIds.value = lists.value.map((l) => l.id);
    if (manifestOk) await cleanupBrokenLists(failed, lists.value.length - failed.length === 0);
    await loadServerState();
    await backfillShares();
  } catch (e) {
    lists.value = [{ id: "tasks.json", label: "tasks" }];
    selectedIds.value = lists.value.map((l) => l.id);
    await cleanupBrokenLists(false, true);
    error.value =
      "Не удалось загрузить списки. Откройте страницу через локальный сервер: <code>npm run dev</code>, затем <code>http://localhost:5173</code>.";
  }
  for (const t of attachedShares.value) {
    await attachShared(t);
  }
  startSharedPolling();
}

async function loadServerState() {
  try {
    const r = await fetch(STATE_FILE);
    if (r.ok) {
      const obj = JSON.parse(await r.text());
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const k of Object.keys(state)) delete state[k];
        Object.assign(state, obj);
        persist();
      }
      return;
    }
    await saveFile(STATE_FILE, JSON.stringify(state));
  } catch (e) {}
}

async function backfillShares() {
  for (const [id, token] of Object.entries(shares)) {
    if (!token || !id) continue;
    await saveFile("shared/" + token + ".meta.json", shareMetaJSON(id));
    if (metas[id]) {
      await saveFile("shared/" + token + ".json", sharedContentFor(id));
    }
  }
}

async function cleanupBrokenLists(failed, allFailed) {
  if (!Array.isArray(failed) || !failed.length || allFailed) return;
  const gone = new Set(failed);
  lists.value = lists.value.filter((l) => !gone.has(l.id));
  selectedIds.value = selectedIds.value.filter((x) => !gone.has(x));
  for (const id of gone) {
    delete metas[id];
    delete colors[id];
  }
  const manifest = lists.value.filter((l) => !l.readonly).map((l) => l.id);
  try {
    await saveFile(USER_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  } catch (e) {}
}

async function seedFromRoot() {
  try {
    const r = await fetch(ROOT_MANIFEST);
    if (!r.ok) return false;
    const items = normalizeManifest(await r.json());
    if (!items.length) {
      await saveFile(USER_MANIFEST, "[]\n");
      lists.value = [];
      return true;
    }
    for (const item of items) {
      try {
        const res = await fetch(item.id);
        if (res.ok) {
          await saveFile(filePath(item.id), await res.text());
        }
      } catch (e) {}
    }
    const manifest = items.map((i) => i.id);
    await saveFile(USER_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    lists.value = items;
    return true;
  } catch (e) {
    return false;
  }
}

function normalizeManifest(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => {
      if (typeof item === "string") {
        return { id: item, label: slugLabel(item), readonly: String(item).startsWith("shared/") };
      }
      return { id: item.file, label: item.name || slugLabel(item.file), readonly: String(item.file || "").startsWith("shared/") };
    })
    .filter((item) => item.id);
}

async function loadAllMetas() {
  const failed = [];
  await Promise.all(
    lists.value.map(async (item) => {
      try {
        const r = await fetch(filePath(item.id));
        if (!r.ok) throw new Error("HTTP " + r.status);
        const text = await r.text();
        try {
          JSON.parse(text);
        } catch (e) {
          throw new Error("invalid JSON");
        }
metas[item.id] = buildMeta(item.id, text);
        item.label = metas[item.id].label;
      } catch (e) {
        failed.push(item.id);
      }
    })
  );
  return failed;
}

const PLACEHOLDER_NAME = "Новый список";

function displayName(data, id) {
  return data.name && data.name.trim() && data.name !== PLACEHOLDER_NAME ? data.name : slugLabel(id);
}

function buildMeta(id, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = {};
  }
  const raw = Array.isArray(data.tasks)
    ? data.tasks
    : typeof data === "string"
      ? data.split("\n")
      : [];
  return {
    id,
    label: displayName(data, id),
    tasks: raw.filter((t) => {
      if (typeof t === "string") return t.trim() !== "";
      if (t && typeof t === "object") return String(t.text || "").trim() !== "";
      return false;
    }),
    raw: text
  };
}

async function saveList(id, content) {
  await saveFile(filePath(id), content);
  metas[id] = buildMeta(id, content);
  if (shares[id]) {
    try {
      await saveFile("shared/" + shares[id] + ".json", sharedContentFor(id));
    } catch (e) {}
  }
}

function sharedContentFor(id) {
  let content = metas[id] ? metas[id].raw : "";
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const list = lists.value.find((l) => l.id === id);
      const label = (list && list.label) || (metas[id] && metas[id].label) || slugLabel(id);
      if (typeof obj.name !== "string" || !obj.name.trim() || obj.name === PLACEHOLDER_NAME) {
        obj.name = label;
        content = JSON.stringify(obj, null, 2);
      }
    }
  } catch (e) {}
  return content;
}

async function addList(fileName, content) {
  const name = String(fileName).trim();
  if (!/^[\p{L}\p{N}._\-\s]+\.json$/iu.test(name)) {
    throw new Error("Имя файла должно быть в виде название.json (буквы, цифры, пробелы, точка, дефис)");
  }
  if (lists.value.some((l) => l.id.toLowerCase() === name.toLowerCase())) {
    throw new Error("Список с таким именем уже существует");
  }
  const parsed = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("В блоке должен быть JSON-объект с полями name и tasks");
  }

  await saveFile(filePath(name), content);

  const manifest = lists.value.filter((l) => !l.readonly).map((l) => l.id);
  manifest.push(name);
  await saveFile(USER_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  const own = manifest.map((id) => ({ id, label: (metas[id] && metas[id].label) || slugLabel(id) }));
  const shared = lists.value.filter((l) => l.readonly);
  metas[name] = buildMeta(name, content);
  const newItem = own.find((x) => x.id === name);
  if (newItem) newItem.label = metas[name].label;
  lists.value = [...shared, ...own];
  selectedIds.value = [...new Set([...selectedIds.value, name])];
}

async function saveFile(file, content) {
  const r = await fetch("/__save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, content })
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || "HTTP " + r.status);
  }
}

async function deleteList(id) {
  if (!lists.value.some((l) => l.id === id)) return;

  const manifest = lists.value.filter((l) => !l.readonly).map((l) => l.id).filter((x) => x !== id);
  await saveFile(USER_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  await deleteFile(filePath(id));

  lists.value = lists.value.filter((l) => l.id !== id);
  selectedIds.value = selectedIds.value.filter((x) => x !== id);
  delete metas[id];
  delete colors[id];
  persistColors();
  delete shares[id];
  persistShares();
}

function buildBackup() {
  return {
    app: "weekplan",
    version: 1,
    createdAt: new Date().toISOString(),
    lists: lists.value.filter((l) => !l.readonly).map((l) => ({
      file: l.id,
      content: metas[l.id] ? metas[l.id].raw : ""
    })),
    dayState: JSON.parse(JSON.stringify(state)),
    colors: JSON.parse(JSON.stringify(colors))
  };
}

async function restoreBackup(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Файл бэкапа повреждён или не распознан");
  }
  if (!Array.isArray(data.lists)) {
    throw new Error("В бэкапе нет поля lists со списками");
  }
  const seen = new Set();
  const files = [];
  for (const l of data.lists) {
    const base = String((l && l.file) || "").split("/").pop();
    const content = String((l && l.content) || "");
    if (!/^[\p{L}\p{N}._\-\s]+\.json$/iu.test(base)) {
      throw new Error("Недопустимое имя файла в бэкапе: " + base);
    }
    if (seen.has(base)) continue;
    seen.add(base);
    try {
      JSON.parse(content);
    } catch (e) {
      throw new Error("Файл " + base + " содержит невалидный JSON: " + e.message);
    }
    files.push({ file: base, content });
  }

  for (const f of files) {
    await saveFile(filePath(f.file), f.content);
  }
  const manifest = files.map((f) => f.file);
  await saveFile(USER_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  const dayState =
    data.dayState && typeof data.dayState === "object" && !Array.isArray(data.dayState)
      ? data.dayState
      : {};
  const backupColors =
    data.colors && typeof data.colors === "object" && !Array.isArray(data.colors)
      ? data.colors
      : {};

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dayState));
  } catch (e) {}
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(backupColors));
  } catch (e) {}

  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, dayState);
  persist();
  queueServerSave();
  for (const k of Object.keys(colors)) delete colors[k];
  Object.assign(colors, backupColors);
  persistColors();

  const prevShared = lists.value.filter((l) => l.readonly);
  lists.value = [...prevShared, ...manifest.map((id) => ({ id, label: slugLabel(id) }))];
  selectedIds.value = [...new Set([...prevShared.map((l) => l.id), ...manifest])];
  error.value = "";
  await loadAllMetas();
}

async function deleteFile(file) {
  const r = await fetch("/__delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file })
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || "HTTP " + r.status);
  }
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

function isDone(dateKey, listId, taskText) {
  return !!(state[dateKey] && state[dateKey][listId] && state[dateKey][listId][taskText]);
}

function toggle(dateKey, listId, taskText, checked) {
  if (!state[dateKey]) state[dateKey] = {};
  if (!state[dateKey][listId]) state[dateKey][listId] = {};
  state[dateKey][listId][taskText] = checked;
  persist();
  queueServerSave();
}

let saveTimer = null;
let statePending = false;

function queueServerSave() {
  statePending = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 300);
}

async function saveStateNow() {
  if (!statePending) return;
  statePending = false;
  try {
    await saveFile(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    statePending = true;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", saveStateNow);
}

function doneCount(listId, dateKey, tasks) {
  const id = listId;
  const map = state[dateKey] && state[dateKey][id] ? state[dateKey][id] : {};
  let done = 0;
  tasks.forEach((t) => {
    const txt = typeof t === "string" ? t : String(t.text || "");
    if (map[txt]) done++;
  });
  return done;
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
    doneCount,
    prevWeek,
    nextWeek,
    goToday
  };
}