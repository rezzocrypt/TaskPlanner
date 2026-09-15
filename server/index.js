import express from "express";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { store, normalizeTaskList, ALLOWED_DAY_RE } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const PORT = process.env.PORT || 3000;
const DAY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_COOKIE = "weekplan-session";
const SESSION_DAYS = 30;
const MAX_NAME = 100;
const COLOR_RE = /^[a-zA-Z0-9#]{3,32}$/;

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function randomToken() {
  return randomBytes(12).toString("base64url");
}

function sessionToken() {
  return randomBytes(32).toString("base64url");
}

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseListBody(body) {
  const name = String((body && body.name) || "").trim().slice(0, MAX_NAME);
  if (!name) {
    return { error: "Название списка не может быть пустым" };
  }
  const tasks = normalizeTaskList(body && body.tasks);
  if (tasks.some((t) => t.text.length > 500)) {
    return { error: "Текст задачи слишком длинный (максимум 500 символов)" };
  }
  return { name, tasks };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return "scrypt$" + salt + "$" + hash;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const test = scryptSync(password, parts[1], 64);
  const expected = Buffer.from(parts[2], "hex");
  return expected.length === test.length && timingSafeEqual(test, expected);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function clearSessionCookie(res) {
  res.append(
    "Set-Cookie",
    SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  );
}

async function createSession(userId, res) {
  const token = sessionToken();
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await store.createSession(token, userId, now, expiresAt);
  res.append(
    "Set-Cookie",
    SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 24 * 60 * 60,
  );
  return token;
}

async function resolveSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  return store.resolveSession(token);
}

function requireAuth(req, res, next) {
  resolveSession(req).then((session) => {
    if (!session) return res.status(401).json({ error: "Требуется вход" });
    req.userId = session.id;
    req.email = session.email;
    next();
  }).catch(next);
}

function parseBackupLists(data) {
  const rawLists = Array.isArray(data.lists) ? data.lists : [];
  const isV1 = rawLists.length > 0 && rawLists.some((l) => l && typeof l.file === "string");
  const lists = [];
  const v1TaskKey = {};
  for (const raw of rawLists) {
    if (!raw || typeof raw !== "object") continue;
    let name = "";
    let tasks = [];
    let key = "";
    if (isV1) {
      key = String(raw.file || "").trim();
      if (!key) continue;
      let content = {};
      try {
        content = JSON.parse(String(raw.content || ""));
      } catch (e) {
        content = {};
      }
      name = String((content && content.name) || "").trim();
      tasks = normalizeTaskList(content && content.tasks);
      tasks = tasks.map((t) => ({ ...t, key: String(t.text) }));
      v1TaskKey[key] = {};
      for (const t of tasks) {
        if (!(t.text in v1TaskKey[key])) v1TaskKey[key][t.text] = t.key;
      }
    } else {
      key = String(raw.id ?? "").trim();
      try {
        name = String(raw.name || "").trim();
      } catch (e) {
        name = "";
      }
      tasks = normalizeTaskList(raw.tasks).map((t) => ({ ...t, key: String(t.id ?? "") }));
    }
    if (!name && !tasks.length) continue;
    lists.push({ key, name, tasks });
  }
  return { isV1, lists, v1TaskKey };
}

function parseBackupColors(data) {
  const colors = {};
  const src =
    data.colors && typeof data.colors === "object" && !Array.isArray(data.colors) ? data.colors : {};
  for (const [key, value] of Object.entries(src)) {
    const color = String(value || "").trim();
    if (color && COLOR_RE.test(color)) colors[String(key)] = color;
  }
  return colors;
}

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/api/me", asyncHandler(async (req, res) => {
  const session = await resolveSession(req);
  res.json({
    id: session ? session.id : null,
    email: session ? session.email : null,
    anonymous: !session,
  });
}));

app.post("/api/register", asyncHandler(async (req, res) => {
  await store.cleanupSessions();
  if (await resolveSession(req)) {
    return res.status(409).json({ error: "Вы уже вошли в систему" });
  }
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Почта не похожа на email" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
  }
  const existing = await store.findUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: "Пользователь с такой почтой уже существует" });
  }
  const user = await store.createUser(email, hashPassword(password));
  await createSession(user.id, res);
  await store.seedUserDefaults(user.id);
  res.status(201).json({ id: user.id, email });
}));

app.post("/api/login", asyncHandler(async (req, res) => {
  await store.cleanupSessions();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await store.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Неверная почта или пароль" });
  }
  await createSession(user.id, res);
  res.json({ id: user.id, email: user.email });
}));

app.post("/api/logout", asyncHandler(async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) await store.deleteSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

app.get("/api/lists", requireAuth, asyncHandler(async (req, res) => {
  const seeded = await store.seedUserDefaults(req.userId);
  const lists = await store.listLists(req.userId);
  res.json({ lists, seeded });
}));

app.get("/api/lists/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  const list = await store.readList(req.userId, id);
  if (!list) return res.status(404).json({ error: "Список не найден" });
  const color = await store.getColor(req.userId, id);
  res.json({ ...list, color });
}));

app.post("/api/lists", requireAuth, asyncHandler(async (req, res) => {
  const parsed = parseListBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const list = await store.createList(req.userId, parsed.name, parsed.tasks);
  res.status(201).json({ ...list, color: "" });
}));

app.put("/api/lists/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!(await store.listExists(req.userId, id)))
    return res.status(404).json({ error: "Список не найден" });
  const parsed = parseListBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const list = await store.updateList(req.userId, id, parsed.name, parsed.tasks);
  const color = await store.getColor(req.userId, id);
  res.json({ ...list, color });
}));

app.delete("/api/lists/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!(await store.deleteList(req.userId, id)))
    return res.status(404).json({ error: "Список не найден" });
  res.json({ ok: true });
}));

app.put("/api/lists/:id/color", requireAuth, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!(await store.listExists(req.userId, id)))
    return res.status(404).json({ error: "Список не найден" });
  const color = String(req.body.color || "").trim();
  if (color) {
    await store.setColor(req.userId, id, color);
  } else {
    await store.clearColor(req.userId, id);
  }
  res.json({ ok: true, color });
}));

app.get("/api/state", requireAuth, asyncHandler(async (req, res) => {
  res.json({ state: await store.getDayState(req.userId) });
}));

app.put("/api/state", requireAuth, asyncHandler(async (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "Ожидается объект state" });
  }
  const ownedTaskIds = await store.getOwnedTaskIds(req.userId);
  await store.replaceDayState(req.userId, state, ownedTaskIds);
  res.json({ ok: true });
}));

app.post("/api/state/toggle", requireAuth, asyncHandler(async (req, res) => {
  const { day, taskId, done } = req.body || {};
  if (!ALLOWED_DAY_RE.test(String(day || ""))) {
    return res.status(400).json({ error: "Недопустимая дата" });
  }
  const id = parseId(taskId);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор задачи" });
  if ((await store.ownerOfTask(id)) !== req.userId) {
    return res.status(404).json({ error: "Задача не найдена" });
  }
  if (done) {
    await store.setDayState(req.userId, String(day), id);
  } else {
    await store.clearDayState(req.userId, String(day), id);
  }
  res.json({ ok: true });
}));

app.post("/api/shares", requireAuth, asyncHandler(async (req, res) => {
  const id = parseId(req.body && req.body.listId);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!(await store.listExists(req.userId, id)))
    return res.status(404).json({ error: "Список не найден" });
  let token = await store.getShareToken(req.userId, id);
  if (!token) {
    token = randomToken();
    await store.createShare(req.userId, id, token);
  }
  res.json({ token, listId: id });
}));

app.delete("/api/shares/:id", requireAuth, asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  await store.deleteShare(req.userId, id);
  res.json({ ok: true });
}));

app.get("/api/shares/:token", asyncHandler(async (req, res) => {
  const token = String(req.params.token || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!token) return res.status(400).json({ error: "Недопустимый токен" });
  const share = await store.findShareByToken(token);
  if (!share) return res.status(404).json({ error: "Средний список не найден" });
  const list = await store.readList(share.owner, share.list_id);
  if (!list) return res.status(404).json({ error: "Список удалён владельцем" });
  const color = await store.getColor(share.owner, share.list_id);
  res.json({ ...list, owner: share.owner, color });
}));

app.get("/api/users/:id/state", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор пользователя" });
  const user = await store.findUserById(id);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  res.json({ state: await store.getDayState(id) });
}));

app.get("/api/backup", requireAuth, asyncHandler(async (req, res) => {
  res.json(await store.getBackupData(req.userId));
}));

app.post("/api/restore", requireAuth, asyncHandler(async (req, res) => {
  const data = req.body;
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Файл бэкапа повреждён или не распознан" });
  }
  const { isV1, lists, v1TaskKey } = parseBackupLists(data);
  if (!lists.length) {
    return res.status(400).json({ error: "В бэкапе нет списков" });
  }
  const colors = parseBackupColors(data);
  const dayState =
    data.dayState && typeof data.dayState === "object" && !Array.isArray(data.dayState)
      ? data.dayState
      : {};
  await store.restore(req.userId, { lists, colors, dayState, isV1, v1TaskKey });
  res.json({ ok: true, lists: lists.length });
}));

/* ------------------------------------------------------------------ */
/*  Static files + SPA fallback                                        */
/* ------------------------------------------------------------------ */

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api\/).*/m, (req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res
      .status(200)
      .type("text/plain")
      .send("API сервера weekplan работает. Соберите фронтенд: npm run build");
  });
}

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: String((err && err.message) || err) });
});

app.listen(PORT, () => {
  console.log("weekplan server: http://localhost:" + PORT);
});
