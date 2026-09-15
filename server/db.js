import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "weekplan.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const legacyColumns = db.prepare("PRAGMA table_info(lists)").all();
if (legacyColumns.length && legacyColumns.some((c) => c.name === "content")) {
  db.exec(`
    DROP TABLE IF EXISTS list_colors;
    DROP TABLE IF EXISTS day_state;
    DROP TABLE IF EXISTS shares;
    DROP TABLE IF EXISTS default_lists;
    DROP TABLE IF EXISTS lists;
  `);
}

const userCols = db.prepare("PRAGMA table_info(users)").all();
if (userCols.length && userCols.some((c) => c.name === "uid")) {
  db.exec(`
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS lists;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS task_days;
    DROP TABLE IF EXISTS list_colors;
    DROP TABLE IF EXISTS day_state;
    DROP TABLE IF EXISTS shares;
    DROP TABLE IF EXISTS user_meta;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner      INTEGER NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    text       TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '',
    end_time   TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);

  CREATE TABLE IF NOT EXISTS task_days (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    day     INTEGER NOT NULL,
    PRIMARY KEY (task_id, day)
  );

  CREATE TABLE IF NOT EXISTS list_colors (
    owner   INTEGER NOT NULL,
    list_id INTEGER NOT NULL,
    color   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (owner, list_id)
  );

  CREATE TABLE IF NOT EXISTS day_state (
    owner   INTEGER NOT NULL,
    day     TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    PRIMARY KEY (owner, day, task_id)
  );

  CREATE TABLE IF NOT EXISTS shares (
    token      TEXT PRIMARY KEY,
    owner      INTEGER NOT NULL,
    list_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (owner, list_id)
  );

  CREATE TABLE IF NOT EXISTS default_templates (
    key  TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS default_template_tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    template_key TEXT NOT NULL REFERENCES default_templates(key) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    text         TEXT NOT NULL,
    start_time   TEXT NOT NULL DEFAULT '',
    end_time     TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS default_template_task_days (
    task_id INTEGER NOT NULL REFERENCES default_template_tasks(id) ON DELETE CASCADE,
    day     INTEGER NOT NULL,
    PRIMARY KEY (task_id, day)
  );

  CREATE TABLE IF NOT EXISTS user_meta (
    owner   INTEGER PRIMARY KEY,
    seeded  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

export function normalizeTaskList(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((t, i) => {
      const task = typeof t === "string" ? { text: t } : t && typeof t === "object" ? t : null;
      if (!task) return null;
      const text = String(task.text || "").trim();
      if (!text) return null;
      return {
        id: Number.isInteger(Number(task.id)) ? Number(task.id) : null,
        text,
        start: String(task.start || ""),
        end: String(task.end || ""),
        days: normalizeDays(task.days),
        position: i
      };
    })
    .filter(Boolean);
}

function normalizeDays(days) {
  const out = [];
  if (!Array.isArray(days)) return [];
  for (const d of days) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export function getList(owner, id) {
  return db.prepare("SELECT id, name FROM lists WHERE id = ? AND owner = ?").get(id, owner);
}

export function listLabel(name, fallback) {
  return String(name || "").trim() ? String(name) : String(fallback);
}

export function readList(owner, id) {
  const row = getList(owner, id);
  if (!row) return null;
  const taskRows = db
    .prepare("SELECT id, text, start_time, end_time FROM tasks WHERE list_id = ? ORDER BY position")
    .all(id);
  const ids = taskRows.map((r) => r.id);
  const daysByTask = {};
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const dayRows = db
      .prepare(`SELECT task_id, day FROM task_days WHERE task_id IN (${ph})`)
      .all(...ids);
    for (const r of dayRows) {
      if (!daysByTask[r.task_id]) daysByTask[r.task_id] = [];
      daysByTask[r.task_id].push(r.day);
    }
  }
  return {
    id: row.id,
    name: row.name,
    tasks: taskRows.map((t) => ({
      id: t.id,
      text: t.text,
      start: t.start_time || "",
      end: t.end_time || "",
      days: (daysByTask[t.id] || []).length
        ? (daysByTask[t.id] || []).slice().sort((a, b) => a - b)
        : null
    }))
  };
}

function storeTasks(listId, tasks) {
  const owned = new Set(
    db.prepare("SELECT id FROM tasks WHERE list_id = ?").all(listId).map((r) => r.id)
  );
  const upd = db.prepare(
    "UPDATE tasks SET text = ?, start_time = ?, end_time = ?, position = ? WHERE id = ? AND list_id = ?"
  );
  const ins = db.prepare(
    "INSERT INTO tasks (list_id, position, text, start_time, end_time) VALUES (?, ?, ?, ?, ?)"
  );
  const delDays = db.prepare("DELETE FROM task_days WHERE task_id = ?");
  const insDay = db.prepare("INSERT OR IGNORE INTO task_days (task_id, day) VALUES (?, ?)");

  const keep = new Set();
  tasks.forEach((t, pos) => {
    let taskId = null;
    if (t.id && owned.has(t.id)) {
      upd.run(t.text, t.start, t.end, pos, t.id, listId);
      taskId = t.id;
    } else {
      taskId = db.prepare(
        "INSERT INTO tasks (list_id, position, text, start_time, end_time) VALUES (?, ?, ?, ?, ?)"
      ).run(listId, pos, t.text, t.start, t.end).lastInsertRowid;
    }
    keep.add(taskId);
    delDays.run(taskId);
    for (const d of t.days) insDay.run(taskId, d);
  });

  if (keep.size) {
    const ph = [...keep].map(() => "?").join(",");
    db.prepare(`DELETE FROM tasks WHERE list_id = ? AND id NOT IN (${ph})`).run(listId, ...keep);
  } else {
    db.prepare("DELETE FROM tasks WHERE list_id = ?").run(listId);
  }
}

export function createList(owner, name, tasks) {
  const row = db.prepare("INSERT INTO lists (owner, name) VALUES (?, ?)").run(owner, name);
  const listId = Number(row.lastInsertRowid);
  const tx = db.transaction(() => storeTasks(listId, tasks));
  tx();
  return readList(owner, listId);
}

export function updateList(owner, id, name, tasks) {
  if (!getList(owner, id)) return null;
  const tx = db.transaction(() => {
    db.prepare("UPDATE lists SET name = ?, updated_at = datetime('now') WHERE id = ? AND owner = ?")
      .run(name, id, owner);
    storeTasks(id, tasks);
  });
  tx();
  return readList(owner, id);
}

export function deleteList(owner, id) {
  if (!getList(owner, id)) return false;
  db.transaction(() => {
    db.prepare("DELETE FROM list_colors WHERE owner = ? AND list_id = ?").run(owner, id);
    db.prepare("DELETE FROM shares WHERE owner = ? AND list_id = ?").run(owner, id);
    db.prepare("DELETE FROM lists WHERE id = ? AND owner = ?").run(id, owner);
  })();
  return true;
}

export function ownerOfTask(taskId) {
  const row = db
    .prepare("SELECT l.owner FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.id = ?")
    .get(taskId);
  return row ? row.owner : null;
}

export function readNestedState(owner) {
  const rows = db.prepare("SELECT day, task_id FROM day_state WHERE owner = ?").all(owner);
  const out = {};
  for (const row of rows) {
    if (!out[row.day]) out[row.day] = {};
    out[row.day][row.task_id] = true;
  }
  return out;
}

export const ALLOWED_DAY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

export function replaceNestedState(owner, state, ownedTaskIds) {
  const del = db.prepare("DELETE FROM day_state WHERE owner = ?");
  const ins = db.prepare(
    "INSERT OR REPLACE INTO day_state (owner, day, task_id) VALUES (?, ?, ?)"
  );
  const tx = db.transaction(() => {
    del.run(owner);
    for (const [day, tasks] of Object.entries(state || {})) {
      if (!ALLOWED_DAY_RE.test(day) || !tasks || typeof tasks !== "object") continue;
      for (const [taskId, done] of Object.entries(tasks)) {
        const id = Number(taskId);
        if (!Number.isInteger(id)) continue;
        if (ownedTaskIds && !ownedTaskIds.has(id)) continue;
        if (done) ins.run(owner, day, id);
      }
    }
  });
  tx();
}

export function getOwnedTaskIds(owner) {
  return new Set(
    db
      .prepare("SELECT t.id FROM tasks t JOIN lists l ON l.id = t.list_id WHERE l.owner = ?")
      .all(owner)
      .map((r) => r.id)
  );
}

export function seedDefaultsIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM default_templates").get().n;
  if (count > 0) return;
  const seedPath = path.join(__dirname, "seed", "default-lists.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  } catch (e) {
    return;
  }
  const items = Array.isArray(data.defaultLists) ? data.defaultLists : [];
  if (!items.length) return;
  const insTemplate = db.prepare("INSERT OR IGNORE INTO default_templates (key, name) VALUES (?, ?)");
  const insTask = db.prepare(
    "INSERT INTO default_template_tasks (template_key, position, text, start_time, end_time) VALUES (?, ?, ?, ?, ?)"
  );
  const insDay = db.prepare(
    "INSERT OR IGNORE INTO default_template_task_days (task_id, day) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const item of items) {
      if (!item || !item.key) continue;
      insTemplate.run(item.key, String(item.name || ""));
      normalizeTaskList(item.tasks).forEach((t) => {
        const res = insTask.run(item.key, t.position, t.text, t.start, t.end);
        for (const d of t.days) insDay.run(res.lastInsertRowid, d);
      });
    }
  });
  tx();
}

export function seedUserDefaults(ownerId) {
  const meta = db.prepare("SELECT seeded FROM user_meta WHERE owner = ?").get(ownerId);
  if (meta && meta.seeded) return false;
  db.prepare(
    "INSERT INTO user_meta (owner, seeded) VALUES (?, 1) ON CONFLICT (owner) DO UPDATE SET seeded = 1"
  ).run(ownerId);
  const templates = db.prepare("SELECT key, name FROM default_templates ORDER BY rowid").all();
  const tx = db.transaction(() => {
    for (const tpl of templates) {
      const listId = db.prepare("INSERT INTO lists (owner, name) VALUES (?, ?)").run(ownerId, tpl.name).lastInsertRowid;
      const taskRows = db
        .prepare(
          "SELECT id, text, start_time, end_time FROM default_template_tasks WHERE template_key = ? ORDER BY position"
        )
        .all(tpl.key);
      const dayRows = taskRows.length
        ? db.prepare(
            `SELECT task_id, day FROM default_template_task_days WHERE task_id IN (${taskRows
              .map(() => "?")
              .join(",")})`
          ).all(...taskRows.map((r) => r.id))
        : [];
      const daysByTask = {};
      for (const r of dayRows) {
        if (!daysByTask[r.task_id]) daysByTask[r.task_id] = [];
        daysByTask[r.task_id].push(r.day);
      }
      storeTasks(listId, taskRows.map((t) => ({
        id: null,
        text: t.text,
        start: t.start_time,
        end: t.end_time,
        days: daysByTask[t.id] || []
      })));
    }
  });
  tx();
  return templates.length > 0;
}

export default db;