import express from "express";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db, {
  getList,
  readList,
  createList,
  updateList,
  deleteList,
  ownerOfTask,
  readNestedState,
  replaceNestedState,
  getOwnedTaskIds,
  seedUserDefaults,
  normalizeTaskList,
  ALLOWED_DAY_RE
} from "./db.js";

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
    SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  );
}

function createSession(userId, res) {
  const token = sessionToken();
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare("INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(token, userId, now, expiresAt);
  res.append(
    "Set-Cookie",
    SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 24 * 60 * 60
  );
  return token;
}

function cleanupSessions() {
  db.prepare("DELETE FROM user_sessions WHERE expires_at < ?").run(Date.now());
}

function resolveSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(
    "SELECT s.user_id, u.email FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?"
  ).get(token, Date.now());
  if (!row) return null;
  return { id: row.user_id, email: row.email };
}

function requireAuth(req, res, next) {
  const session = resolveSession(req);
  if (!session) {
    return res.status(401).json({ error: "Требуется вход" });
  }
  req.userId = session.id;
  req.email = session.email;
  next();
}

export function getBackupPayload(owner) {
  const listRows = db.prepare("SELECT id FROM lists WHERE owner = ? ORDER BY rowid").all(owner);
  const colorRows = db.prepare("SELECT list_id, color FROM list_colors WHERE owner = ? AND color != ''").all(owner);
  const colors = {};
  for (const c of colorRows) colors[String(c.list_id)] = c.color;
  return {
    app: "weekplan",
    version: 2,
    createdAt: new Date().toISOString(),
    lists: listRows.map((r) => {
      const list = readList(owner, r.id);
      return { id: list.id, name: list.name, tasks: list.tasks };
    }),
    dayState: readNestedState(owner),
    colors
  };
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
      name = String(content && content.name || "").trim();
      tasks = normalizeTaskList(content && content.tasks);
      tasks = tasks.map((t) => ({ ...t, key: String(t.text) }));
      v1TaskKey[key] = {};
      for (const t of tasks) {
        if (!(t.text in v1TaskKey[key])) v1TaskKey[key][t.text] = t.key;
      }
    } else {
      key = String((raw.id ?? "")).trim();
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
  const src = data.colors && typeof data.colors === "object" && !Array.isArray(data.colors)
    ? data.colors
    : {};
  for (const [key, value] of Object.entries(src)) {
    const color = String(value || "").trim();
    if (color && COLOR_RE.test(color)) colors[String(key)] = color;
  }
  return colors;
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/api/me", (req, res) => {
  const session = resolveSession(req);
  res.json({
    id: session ? session.id : null,
    email: session ? session.email : null,
    anonymous: !session
  });
});

app.post("/api/register", (req, res) => {
  cleanupSessions();
  if (resolveSession(req)) {
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
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "Пользователь с такой почтой уже существует" });
  }
  const result = db.prepare("INSERT INTO users (email, password) VALUES (?, ?)")
    .run(email, hashPassword(password));
  const userId = result.lastInsertRowid;
  createSession(userId, res);
  seedUserDefaults(userId);
  res.status(201).json({ id: userId, email });
});

app.post("/api/login", (req, res) => {
  cleanupSessions();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT id, email, password FROM users WHERE email = ?").get(email);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: "Неверная почта или пароль" });
  }
  createSession(user.id, res);
  res.json({ id: user.id, email: user.email });
});

app.post("/api/logout", (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/lists", requireAuth, (req, res) => {
  const seeded = seedUserDefaults(req.userId);
  const rows = db.prepare("SELECT id, name FROM lists WHERE owner = ? ORDER BY rowid").all(req.userId);
  const colorRows = db.prepare("SELECT list_id, color FROM list_colors WHERE owner = ?").all(req.userId);
  const shareRows = db.prepare("SELECT list_id, token FROM list_shares WHERE owner = ?").all(req.userId);
  const colorByList = {};
  for (const c of colorRows) colorByList[c.list_id] = c.color;
  const tokenByList = {};
  for (const s of shareRows) tokenByList[s.list_id] = s.token;
  const lists = rows.map((row) => ({
    id: row.id,
    label: row.name || "Без названия",
    readonly: false,
    color: colorByList[row.id] || "",
    token: tokenByList[row.id] || ""
  }));
  res.json({ lists, seeded });
});

app.get("/api/lists/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  const list = readList(req.userId, id);
  if (!list) return res.status(404).json({ error: "Список не найден" });
  const colorRow = db.prepare("SELECT color FROM list_colors WHERE owner = ? AND list_id = ?").get(req.userId, id);
  res.json({ ...list, color: colorRow && colorRow.color ? colorRow.color : "" });
});

app.post("/api/lists", requireAuth, (req, res) => {
  const parsed = parseListBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const list = createList(req.userId, parsed.name, parsed.tasks);
  res.status(201).json({ ...list, color: "" });
});

app.put("/api/lists/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!getList(req.userId, id)) return res.status(404).json({ error: "Список не найден" });
  const parsed = parseListBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const list = updateList(req.userId, id, parsed.name, parsed.tasks);
  const colorRow = db.prepare("SELECT color FROM list_colors WHERE owner = ? AND list_id = ?").get(req.userId, id);
  res.json({ ...list, color: colorRow && colorRow.color ? colorRow.color : "" });
});

app.delete("/api/lists/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!deleteList(req.userId, id)) return res.status(404).json({ error: "Список не найден" });
  res.json({ ok: true });
});

app.put("/api/lists/:id/color", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!getList(req.userId, id)) return res.status(404).json({ error: "Список не найден" });
  const color = String(req.body.color || "").trim();
  if (color) {
    db.prepare(
      "INSERT INTO list_colors (owner, list_id, color) VALUES (?, ?, ?) ON CONFLICT (owner, list_id) DO UPDATE SET color = excluded.color"
    ).run(req.userId, id, color);
  } else {
    db.prepare("DELETE FROM list_colors WHERE owner = ? AND list_id = ?").run(req.userId, id);
  }
  res.json({ ok: true, color });
});

app.get("/api/state", requireAuth, (req, res) => {
  res.json({ state: readNestedState(req.userId) });
});

app.put("/api/state", requireAuth, (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "Ожидается объект state" });
  }
  replaceNestedState(req.userId, state, getOwnedTaskIds(req.userId));
  res.json({ ok: true });
});

app.post("/api/state/toggle", requireAuth, (req, res) => {
  const { day, taskId, done } = req.body || {};
  if (!ALLOWED_DAY_RE.test(String(day || ""))) {
    return res.status(400).json({ error: "Недопустимая дата" });
  }
  const id = parseId(taskId);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор задачи" });
  if (ownerOfTask(id) !== req.userId) {
    return res.status(404).json({ error: "Задача не найдена" });
  }
  if (done) {
db.prepare("INSERT OR REPLACE INTO user_task_state (owner, day, task_id) VALUES (?, ?, ?)")
      .run(req.userId, String(day), id);
  } else {
    db.prepare("DELETE FROM user_task_state WHERE owner = ? AND day = ? AND task_id = ?")
      .run(req.userId, String(day), id);
  }
  res.json({ ok: true });
});

app.post("/api/shares", requireAuth, (req, res) => {
  const id = parseId(req.body && req.body.listId);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  if (!getList(req.userId, id)) return res.status(404).json({ error: "Список не найден" });
  let token = db.prepare("SELECT token FROM list_shares WHERE owner = ? AND list_id = ?").get(req.userId, id);
  if (!token) {
    token = randomToken();
    db.prepare("INSERT INTO list_shares (token, owner, list_id) VALUES (?, ?, ?)").run(token, req.userId, id);
  } else {
    token = token.token;
  }
  res.json({ token, listId: id });
});

app.delete("/api/shares/:id", requireAuth, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Недопустимый идентификатор списка" });
  db.prepare("DELETE FROM list_shares WHERE owner = ? AND list_id = ?").run(req.userId, id);
  res.json({ ok: true });
});

app.get("/api/shares/:token", (req, res) => {
  const token = String(req.params.token || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!token) return res.status(400).json({ error: "Недопустимый токен" });
  const share = db.prepare("SELECT * FROM list_shares WHERE token = ?").get(token);
  if (!share) return res.status(404).json({ error: "Средний список не найден" });
  const list = readList(share.owner, share.list_id);
  if (!list) return res.status(404).json({ error: "Список удалён владельцем" });
  const colorRow = db.prepare("SELECT color FROM list_colors WHERE owner = ? AND list_id = ?").get(share.owner, share.list_id);
  res.json({
    ...list,
    owner: share.owner,
    color: colorRow && colorRow.color ? colorRow.color : ""
  });
});

app.get("/api/users/:id/state", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Недопустимый идентификатор пользователя" });
  }
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  res.json({ state: readNestedState(id) });
});

app.get("/api/backup", requireAuth, (req, res) => {
  res.json(getBackupPayload(req.userId));
});

app.post("/api/restore", requireAuth, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Файл бэкапа повреждён или не распознан" });
  }
  const { isV1, lists, v1TaskKey } = parseBackupLists(data);
  if (!lists.length) {
    return res.status(400).json({ error: "В бэкапе нет списков" });
  }
  const colors = parseBackupColors(data);

  const insertList = db.prepare("INSERT INTO lists (owner, name) VALUES (?, ?)");
  const insertTask = db.prepare(
    "INSERT INTO tasks (list_id, position, text, start_time, end_time) VALUES (?, ?, ?, ?, ?)"
  );
  const insertDay = db.prepare("INSERT OR IGNORE INTO task_days (task_id, day) VALUES (?, ?)");
  const insColor = db.prepare(
    "INSERT INTO list_colors (owner, list_id, color) VALUES (?, ?, ?) ON CONFLICT (owner, list_id) DO UPDATE SET color = excluded.color"
  );
  const insState = db.prepare("INSERT OR REPLACE INTO user_task_state (owner, day, task_id) VALUES (?, ?, ?)");

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM lists WHERE owner = ?").run(req.userId);
    db.prepare("DELETE FROM list_colors WHERE owner = ?").run(req.userId);
    db.prepare("DELETE FROM list_shares WHERE owner = ?").run(req.userId);
    db.prepare("DELETE FROM user_task_state WHERE owner = ?").run(req.userId);

    const listIdByKey = {};
    const oldTaskIdMap = {};
    for (const l of lists) {
      const listId = insertList.run(req.userId, l.name).lastInsertRowid;
      if (l.key) listIdByKey[l.key] = listId;
      l.tasks.forEach((t, pos) => {
        const taskId = insertTask.run(listId, pos, t.text, t.start, t.end).lastInsertRowid;
        for (const d of t.days) insertDay.run(taskId, d);
        if (!isV1 && t.key) oldTaskIdMap[t.key] = taskId;
        if (isV1 && t.key) v1TaskKey[l.key][t.text] = taskId;
      });
    }

    for (const [key, color] of Object.entries(colors)) {
      const listId = listIdByKey[key];
      if (listId) insColor.run(req.userId, listId, color);
    }

    const dayState =
      data.dayState && typeof data.dayState === "object" && !Array.isArray(data.dayState)
        ? data.dayState
        : {};
    if (isV1) {
      for (const [day, files] of Object.entries(dayState)) {
        if (!DAY_RE.test(day) || !files || typeof files !== "object") continue;
        for (const [file, tasks] of Object.entries(files)) {
          if (!tasks || typeof tasks !== "object") continue;
          for (const [text, done] of Object.entries(tasks)) {
            if (!done) continue;
            const tid = v1TaskKey[file] && v1TaskKey[file][text];
            if (tid) insState.run(req.userId, day, tid);
          }
        }
      }
    } else {
      for (const [day, tasks] of Object.entries(dayState)) {
        if (!DAY_RE.test(day) || !tasks || typeof tasks !== "object") continue;
        for (const [taskId, done] of Object.entries(tasks)) {
          if (!done) continue;
          const tid = oldTaskIdMap[String(taskId)];
          if (tid) insState.run(req.userId, day, tid);
        }
      }
    }
  });
  tx();
  res.json({ ok: true, lists: lists.length });
});

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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: String(err && err.message || err) });
});

app.listen(PORT, () => {
  console.log("weekplan server: http://localhost:" + PORT);
});