import express from "express";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db, { listMeta, seedDefaultsIfEmpty, seedUserDefaults } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const PORT = process.env.PORT || 3000;
const UID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
const FILE_RE = /^[\p{L}\p{N}._\-\s]+\.json$/iu;
const DAY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

function randomUid() {
  return randomBytes(15).toString("base64url");
}

function randomToken() {
  return randomBytes(12).toString("base64url");
}

function uidFromRequest(req) {
  const m = /(?:^|;\s*)weekplan-uid=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return "";
  const raw = decodeURIComponent(m[1]);
  return UID_RE.test(raw) ? raw : "";
}

function requireUid(req, res, next) {
  const uid = uidFromRequest(req);
  if (!uid) {
    return res.status(401).json({ error: "Нет идентификатора пользователя" });
  }
  req.uid = uid;
  next();
}

function readNestedState(owner) {
  const rows = db.prepare("SELECT day, file, task FROM day_state WHERE owner = ?").all(owner);
  const out = {};
  for (const row of rows) {
    if (!out[row.day]) out[row.day] = {};
    if (!out[row.day][row.file]) out[row.day][row.file] = {};
    out[row.day][row.file][row.task] = true;
  }
  return out;
}

function replaceNestedState(owner, state) {
  const del = db.prepare("DELETE FROM day_state WHERE owner = ?");
  const ins = db.prepare(
    "INSERT OR REPLACE INTO day_state (owner, day, file, task) VALUES (?, ?, ?, ?)"
  );
  const tx = db.transaction(() => {
    del.run(owner);
    for (const [day, files] of Object.entries(state)) {
      if (!DAY_RE.test(day) || !files || typeof files !== "object") continue;
      for (const [file, tasks] of Object.entries(files)) {
        if (!FILE_RE.test(file) || !tasks || typeof tasks !== "object") continue;
        for (const [task, done] of Object.entries(tasks)) {
          if (task && done) ins.run(owner, day, file, task);
        }
      }
    }
  });
  tx();
}

function getListRow(owner, file) {
  return db.prepare("SELECT content FROM lists WHERE owner = ? AND file = ?").get(owner, file);
}

function getBackupPayload(owner) {
  const listRows = db.prepare("SELECT file, content FROM lists WHERE owner = ? ORDER BY rowid").all(owner);
  const colorRows = db.prepare("SELECT file, color FROM list_colors WHERE owner = ? AND color != ''").all(owner);
  const colors = {};
  for (const c of colorRows) colors[c.file] = c.color;
  return {
    app: "weekplan",
    version: 1,
    createdAt: new Date().toISOString(),
    lists: listRows.map((r) => ({ file: r.file, content: r.content })),
    dayState: readNestedState(owner),
    colors
  };
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/api/me", (req, res) => {
  let uid = uidFromRequest(req);
  const isNew = !uid;
  if (!uid) {
    uid = randomUid();
    res.setHeader(
      "Set-Cookie",
      "weekplan-uid=" + encodeURIComponent(uid) + "; Path=/; Max-Age=31536000; SameSite=Lax"
    );
  }
  seedUserDefaults(uid);
  res.json({ uid, isNew });
});

app.get("/api/lists", requireUid, (req, res) => {
  const seeded = seedUserDefaults(req.uid);
  const rows = db.prepare("SELECT file FROM lists WHERE owner = ? ORDER BY rowid").all(req.uid);
  const colorRows = db.prepare("SELECT file, color FROM list_colors WHERE owner = ?").all(req.uid);
  const shareRows = db.prepare("SELECT file, token FROM shares WHERE owner = ?").all(req.uid);
  const colorByFile = {};
  for (const c of colorRows) colorByFile[c.file] = c.color;
  const tokenByFile = {};
  for (const s of shareRows) tokenByFile[s.file] = s.token;
  const lists = [];
  for (const row of rows) {
    const meta = listMeta(row.file, getListRow(req.uid, row.file).content);
    lists.push({
      id: row.file,
      label: meta.label,
      readonly: false,
      color: colorByFile[row.file] || "",
      token: tokenByFile[row.file] || ""
    });
  }
  res.json({ lists, seeded });
});

app.get("/api/lists/:file", requireUid, (req, res) => {
  const row = getListRow(req.uid, req.params.file);
  if (!row) return res.status(404).json({ error: "Список не найден" });
  const colorRow = db.prepare("SELECT color FROM list_colors WHERE owner = ? AND file = ?").get(req.uid, req.params.file);
  res.json({ ...listMeta(req.params.file, row.content), color: colorRow && colorRow.color ? colorRow.color : "" });
});

app.post("/api/lists", requireUid, (req, res) => {
  const file = String(req.body.file || "").trim();
  const content = String(req.body.content || "");
  if (!FILE_RE.test(file)) {
    return res.status(400).json({ error: "Имя файла должно быть в виде название.json (буквы, цифры, пробелы, точка, дефис)" });
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return res.status(400).json({ error: "Содержимое должно быть валидным JSON" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return res.status(400).json({ error: "В блоке должен быть JSON-объект с полями name и tasks" });
  }
  if (getListRow(req.uid, file)) {
    return res.status(409).json({ error: "Список с таким именем уже существует" });
  }
  db.prepare("INSERT INTO lists (owner, file, content) VALUES (?, ?, ?)").run(req.uid, file, content);
  res.json({ ...listMeta(file, content), color: "" });
});

app.put("/api/lists/:file", requireUid, (req, res) => {
  const content = String(req.body.content || "");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return res.status(400).json({ error: "Содержимое должно быть валидным JSON" });
  }
  if (parsed === null || typeof parsed !== "object") {
    return res.status(400).json({ error: "Содержимое должно быть JSON-объектом с полями name и tasks" });
  }
  const existing = getListRow(req.uid, req.params.file);
  if (!existing) return res.status(404).json({ error: "Список не найден" });
  db.prepare("UPDATE lists SET content = ?, updated_at = datetime('now') WHERE owner = ? AND file = ?")
    .run(content, req.uid, req.params.file);
  const colorRow = db.prepare("SELECT color FROM list_colors WHERE owner = ? AND file = ?").get(req.uid, req.params.file);
  res.json({ ...listMeta(req.params.file, content), color: colorRow && colorRow.color ? colorRow.color : "" });
});

app.delete("/api/lists/:file", requireUid, (req, res) => {
  const file = req.params.file;
  if (!getListRow(req.uid, file)) return res.status(404).json({ error: "Список не найден" });
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM lists WHERE owner = ? AND file = ?").run(req.uid, file);
    db.prepare("DELETE FROM list_colors WHERE owner = ? AND file = ?").run(req.uid, file);
    db.prepare("DELETE FROM day_state WHERE owner = ? AND file = ?").run(req.uid, file);
    db.prepare("DELETE FROM shares WHERE owner = ? AND file = ?").run(req.uid, file);
  });
  tx();
  res.json({ ok: true });
});

app.put("/api/lists/:file/color", requireUid, (req, res) => {
  const color = String(req.body.color || "").trim();
  const file = req.params.file;
  if (!getListRow(req.uid, file)) return res.status(404).json({ error: "Список не найден" });
  if (color) {
    db.prepare(
      "INSERT INTO list_colors (owner, file, color) VALUES (?, ?, ?) ON CONFLICT (owner, file) DO UPDATE SET color = excluded.color"
    ).run(req.uid, file, color);
  } else {
    db.prepare("DELETE FROM list_colors WHERE owner = ? AND file = ?").run(req.uid, file);
  }
  res.json({ ok: true, color });
});

app.get("/api/state", requireUid, (req, res) => {
  res.json({ state: readNestedState(req.uid) });
});

app.put("/api/state", requireUid, (req, res) => {
  const state = req.body && req.body.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "Ожидается объект state" });
  }
  replaceNestedState(req.uid, state);
  res.json({ ok: true });
});

app.post("/api/state/toggle", requireUid, (req, res) => {
  const { day, file, task, done } = req.body || {};
  if (!DAY_RE.test(String(day || ""))) {
    return res.status(400).json({ error: "Недопустимая дата" });
  }
  if (!FILE_RE.test(String(file || ""))) {
    return res.status(400).json({ error: "Недопустимое имя файла" });
  }
  const txt = String(task || "");
  if (!txt) return res.status(400).json({ error: "Задача не может быть пустой" });
  if (done) {
    db.prepare("INSERT OR REPLACE INTO day_state (owner, day, file, task) VALUES (?, ?, ?, ?)")
      .run(req.uid, day, file, txt);
  } else {
    db.prepare("DELETE FROM day_state WHERE owner = ? AND day = ? AND file = ? AND task = ?")
      .run(req.uid, day, file, txt);
  }
  res.json({ ok: true });
});

app.post("/api/shares", requireUid, (req, res) => {
  const file = String(req.body.file || "").trim();
  if (!FILE_RE.test(file)) return res.status(400).json({ error: "Недопустимое имя файла" });
  if (!getListRow(req.uid, file)) return res.status(404).json({ error: "Список не найден" });
  let token = db.prepare("SELECT token FROM shares WHERE owner = ? AND file = ?").get(req.uid, file);
  if (!token) {
    token = randomToken();
    db.prepare("INSERT INTO shares (token, owner, file) VALUES (?, ?, ?)").run(token, req.uid, file);
  } else {
    token = token.token;
  }
  res.json({ token, file });
});

app.delete("/api/shares/:file", requireUid, (req, res) => {
  db.prepare("DELETE FROM shares WHERE owner = ? AND file = ?").run(req.uid, req.params.file);
  res.json({ ok: true });
});

app.get("/api/shares/:token", (req, res) => {
  const token = String(req.params.token || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!token) return res.status(400).json({ error: "Недопустимый токен" });
  const share = db.prepare("SELECT * FROM shares WHERE token = ?").get(token);
  if (!share) return res.status(404).json({ error: "Средний список не найден" });
  const row = getListRow(share.owner, share.file);
  if (!row) return res.status(404).json({ error: "Список удалён владельцем" });
  const colorRow = db.prepare("SELECT color FROM list_colors WHERE owner = ? AND file = ?").get(share.owner, share.file);
  const meta = listMeta(share.file, row.content);
  res.json({
    ...meta,
    owner: share.owner,
    file: share.file,
    color: colorRow && colorRow.color ? colorRow.color : ""
  });
});

app.get("/api/users/:uid/state", (req, res) => {
  const uid = String(req.params.uid || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!UID_RE.test(uid)) {
    return res.status(400).json({ error: "Недопустимый идентификатор пользователя" });
  }
  res.json({ state: readNestedState(uid) });
});

app.get("/api/backup", requireUid, (req, res) => {
  res.json(getBackupPayload(req.uid));
});

app.post("/api/restore", requireUid, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== "object") {
    return res.status(400).json({ error: "Файл бэкапа повреждён или не распознан" });
  }
  if (!Array.isArray(data.lists)) {
    return res.status(400).json({ error: "В бэкапе нет поля lists со списками" });
  }
  const seen = new Set();
  const files = [];
  for (const l of data.lists) {
    const base = String((l && l.file) || "").split("/").pop();
    const content = String((l && l.content) || "");
    if (!FILE_RE.test(base)) {
      return res.status(400).json({ error: "Недопустимое имя файла в бэкапе: " + base });
    }
    if (seen.has(base)) continue;
    seen.add(base);
    try {
      const parsed = JSON.parse(content);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return res.status(400).json({ error: "Файл " + base + " должен содержать JSON-объект" });
      }
    } catch (e) {
      return res.status(400).json({ error: "Файл " + base + " содержит невалидный JSON: " + e.message });
    }
    files.push({ file: base, content });
  }

  const dayState =
    data.dayState && typeof data.dayState === "object" && !Array.isArray(data.dayState)
      ? data.dayState
      : {};
  const colors =
    data.colors && typeof data.colors === "object" && !Array.isArray(data.colors) ? data.colors : {};

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM lists WHERE owner = ?").run(req.uid);
    db.prepare("DELETE FROM list_colors WHERE owner = ?").run(req.uid);
    const ins = db.prepare("INSERT INTO lists (owner, file, content) VALUES (?, ?, ?)");
    for (const f of files) ins.run(req.uid, f.file, f.content);
    const insColor = db.prepare(
      "INSERT INTO list_colors (owner, file, color) VALUES (?, ?, ?) ON CONFLICT (owner, file) DO UPDATE SET color = excluded.color"
    );
    for (const [file, color] of Object.entries(colors)) {
      if (color && file) insColor.run(req.uid, file, String(color));
    }
    replaceNestedState(req.uid, dayState);
  });
  tx();
  res.json({ ok: true, lists: files.map((f) => f.file) });
});

seedDefaultsIfEmpty();

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