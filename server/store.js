import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.WEEKSTREAK_DB || path.join(__dirname, "..", "data", "weekstreak.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

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

  CREATE TABLE IF NOT EXISTS user_task_state (
    owner   INTEGER NOT NULL,
    day     TEXT NOT NULL,
    task_id INTEGER NOT NULL,
    PRIMARY KEY (owner, day, task_id)
  );

  CREATE TABLE IF NOT EXISTS list_shares (
    token      TEXT PRIMARY KEY,
    owner      INTEGER NOT NULL,
    list_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (owner, list_id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    seeded     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const userTableCols = db.prepare("PRAGMA table_info(users)").all();
if (userTableCols.length && !userTableCols.some((c) => c.name === "seeded")) {
  throw new Error(
    `Таблица users не содержит колонку seeded — устаревшая схема. ` +
      `Удалите файл базы данных: ${DB_PATH}`
  );
}

/* ------------------------------------------------------------------ */
/*  Pure helpers (no side-effects, usable outside the store)           */
/* ------------------------------------------------------------------ */

export function normalizeDays(days) {
  const out = [];
  if (!Array.isArray(days)) return [];
  for (const d of days) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

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
        position: i,
      };
    })
    .filter(Boolean);
}

export const ALLOWED_DAY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

/* ------------------------------------------------------------------ */
/*  Internal (synchronous) SQL helpers – wrapped in async at the end   */
/* ------------------------------------------------------------------ */

function _getList(owner, id) {
  return db.prepare("SELECT id, name FROM lists WHERE id = ? AND owner = ?").get(id, owner);
}

function _readList(owner, id) {
  const row = _getList(owner, id);
  if (!row) return null;
  const taskRows = db
    .prepare("SELECT id, text, start_time, end_time FROM tasks WHERE list_id = ? ORDER BY position")
    .all(id);
  const ids = taskRows.map((r) => r.id);
  const daysByTask = {};
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    const dayRows = db.prepare(`SELECT task_id, day FROM task_days WHERE task_id IN (${ph})`).all(...ids);
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
        : null,
    })),
  };
}

function _storeTasks(listId, tasks) {
  const owned = new Set(
    db.prepare("SELECT id FROM tasks WHERE list_id = ?").all(listId).map((r) => r.id),
  );
  const upd = db.prepare(
    "UPDATE tasks SET text = ?, start_time = ?, end_time = ?, position = ? WHERE id = ? AND list_id = ?",
  );
  const ins = db.prepare(
    "INSERT INTO tasks (list_id, position, text, start_time, end_time) VALUES (?, ?, ?, ?, ?)",
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
      taskId = ins.run(listId, pos, t.text, t.start, t.end).lastInsertRowid;
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

function _seedUserDefaults(ownerId) {
  const row = db.prepare("SELECT seeded FROM users WHERE id = ?").get(ownerId);
  if (row && row.seeded) return false;
  const seedPath = path.join(__dirname, "seed", "default-lists.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  } catch (e) {
    return false;
  }
  const items = Array.isArray(data.defaultLists) ? data.defaultLists : [];
  if (!items.length) return false;
  db.prepare("UPDATE users SET seeded = 1 WHERE id = ?").run(ownerId);
  const tx = db.transaction(() => {
    for (const item of items) {
      if (!item || !item.name) continue;
      const listId = db
        .prepare("INSERT INTO lists (owner, name) VALUES (?, ?)")
        .run(ownerId, String(item.name))
        .lastInsertRowid;
      _storeTasks(
        listId,
        normalizeTaskList(item.tasks).map((t) => ({
          id: null,
          text: t.text,
          start: t.start,
          end: t.end,
          days: t.days,
        })),
      );
    }
  });
  tx();
  return true;
}

function _readNestedState(owner) {
  const rows = db.prepare("SELECT day, task_id FROM user_task_state WHERE owner = ?").all(owner);
  const out = {};
  for (const row of rows) {
    if (!out[row.day]) out[row.day] = {};
    out[row.day][row.task_id] = true;
  }
  return out;
}

function _getOwnedTaskIds(owner) {
  return new Set(
    db
      .prepare("SELECT t.id FROM tasks t JOIN lists l ON l.id = t.list_id WHERE l.owner = ?")
      .all(owner)
      .map((r) => r.id),
  );
}

/* ------------------------------------------------------------------ */
/*  Public async store                                                 */
/* ------------------------------------------------------------------ */

export const store = {
  /* ---- Users ---------------------------------------------------- */

  async findUserByEmail(email) {
    return db.prepare("SELECT id, email, password FROM users WHERE email = ?").get(email) || null;
  },

  async findUserById(id) {
    return db.prepare("SELECT id FROM users WHERE id = ?").get(id) || null;
  },

  async createUser(email, passwordHash) {
    const r = db.prepare("INSERT INTO users (email, password) VALUES (?, ?)").run(email, passwordHash);
    return { id: r.lastInsertRowid, email };
  },

  async getSeeded(userId) {
    const r = db.prepare("SELECT seeded FROM users WHERE id = ?").get(userId);
    return !!(r && r.seeded);
  },

  async setSeeded(userId) {
    db.prepare("UPDATE users SET seeded = 1 WHERE id = ?").run(userId);
  },

  /* ---- Sessions ------------------------------------------------- */

  async createSession(token, userId, createdAt, expiresAt) {
    db.prepare(
      "INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(token, userId, createdAt, expiresAt);
  },

  async cleanupSessions() {
    db.prepare("DELETE FROM user_sessions WHERE expires_at < ?").run(Date.now());
  },

  async resolveSession(token) {
    const row = db
      .prepare(
        "SELECT s.user_id, u.email FROM user_sessions s " +
          "JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?",
      )
      .get(token, Date.now());
    return row ? { id: row.user_id, email: row.email } : null;
  },

  async deleteSession(token) {
    db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
  },

  /* ---- Lists ---------------------------------------------------- */

  async listLists(owner) {
    const rows = db.prepare("SELECT id, name FROM lists WHERE owner = ? ORDER BY rowid").all(owner);
    const colorRows = db.prepare("SELECT list_id, color FROM list_colors WHERE owner = ?").all(owner);
    const shareRows = db.prepare("SELECT list_id, token FROM list_shares WHERE owner = ?").all(owner);
    const colorByList = {};
    for (const c of colorRows) colorByList[c.list_id] = c.color;
    const tokenByList = {};
    for (const s of shareRows) tokenByList[s.list_id] = s.token;
    return rows.map((row) => ({
      id: row.id,
      label: row.name || "Без названия",
      readonly: false,
      color: colorByList[row.id] || "",
      token: tokenByList[row.id] || "",
    }));
  },

  async readList(owner, id) {
    return _readList(owner, id);
  },

  async createList(owner, name, tasks) {
    const listId = Number(db.prepare("INSERT INTO lists (owner, name) VALUES (?, ?)").run(owner, name).lastInsertRowid);
    db.transaction(() => _storeTasks(listId, tasks))();
    return _readList(owner, listId);
  },

  async updateList(owner, id, name, tasks) {
    if (!_getList(owner, id)) return null;
    db.transaction(() => {
      db.prepare("UPDATE lists SET name = ?, updated_at = datetime('now') WHERE id = ? AND owner = ?")
        .run(name, id, owner);
      _storeTasks(id, tasks);
    })();
    return _readList(owner, id);
  },

  async deleteList(owner, id) {
    if (!_getList(owner, id)) return false;
    db.transaction(() => {
      db.prepare("DELETE FROM list_colors WHERE owner = ? AND list_id = ?").run(owner, id);
      db.prepare("DELETE FROM list_shares WHERE owner = ? AND list_id = ?").run(owner, id);
      db.prepare("DELETE FROM lists WHERE id = ? AND owner = ?").run(id, owner);
    })();
    return true;
  },

  async listExists(owner, id) {
    return !!_getList(owner, id);
  },

  /* ---- Colors --------------------------------------------------- */

  async getColor(owner, listId) {
    const r = db.prepare("SELECT color FROM list_colors WHERE owner = ? AND list_id = ?").get(owner, listId);
    return r && r.color ? r.color : "";
  },

  async setColor(owner, listId, color) {
    db.prepare(
      "INSERT INTO list_colors (owner, list_id, color) VALUES (?, ?, ?) " +
        "ON CONFLICT (owner, list_id) DO UPDATE SET color = excluded.color",
    ).run(owner, listId, color);
  },

  async clearColor(owner, listId) {
    db.prepare("DELETE FROM list_colors WHERE owner = ? AND list_id = ?").run(owner, listId);
  },

  /* ---- Shares --------------------------------------------------- */

  async getShareToken(owner, listId) {
    const r = db.prepare("SELECT token FROM list_shares WHERE owner = ? AND list_id = ?").get(owner, listId);
    return r ? r.token : null;
  },

  async createShare(owner, listId, token) {
    db.prepare("INSERT INTO list_shares (token, owner, list_id) VALUES (?, ?, ?)").run(token, owner, listId);
  },

  async deleteShare(owner, listId) {
    db.prepare("DELETE FROM list_shares WHERE owner = ? AND list_id = ?").run(owner, listId);
  },

  async findShareByToken(token) {
    return db.prepare("SELECT * FROM list_shares WHERE token = ?").get(token) || null;
  },

  /* ---- State ---------------------------------------------------- */

  async getDayState(owner) {
    return _readNestedState(owner);
  },

  async setDayState(owner, day, taskId) {
    db.prepare("INSERT OR REPLACE INTO user_task_state (owner, day, task_id) VALUES (?, ?, ?)")
      .run(owner, day, taskId);
  },

  async clearDayState(owner, day, taskId) {
    db.prepare("DELETE FROM user_task_state WHERE owner = ? AND day = ? AND task_id = ?")
      .run(owner, day, taskId);
  },

  async replaceDayState(owner, state, ownedTaskIds) {
    const del = db.prepare("DELETE FROM user_task_state WHERE owner = ?");
    const ins = db.prepare("INSERT OR REPLACE INTO user_task_state (owner, day, task_id) VALUES (?, ?, ?)");
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
  },

  /* ---- Tasks (cross-cutting) ------------------------------------ */

  async ownerOfTask(taskId) {
    const row = db
      .prepare("SELECT l.owner FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.id = ?")
      .get(taskId);
    return row ? row.owner : null;
  },

  async getOwnedTaskIds(owner) {
    return _getOwnedTaskIds(owner);
  },

  /* ---- Backup / Restore ----------------------------------------- */

  async getBackupData(owner) {
    const listRows = db.prepare("SELECT id FROM lists WHERE owner = ? ORDER BY rowid").all(owner);
    const colorRows = db
      .prepare("SELECT list_id, color FROM list_colors WHERE owner = ? AND color != ''")
      .all(owner);
    const colors = {};
    for (const c of colorRows) colors[String(c.list_id)] = c.color;
    return {
      app: "weekstreak",
      version: 2,
      createdAt: new Date().toISOString(),
      lists: listRows.map((r) => {
        const list = _readList(owner, r.id);
        return { id: list.id, name: list.name, tasks: list.tasks };
      }),
      dayState: _readNestedState(owner),
      colors,
    };
  },

  async restore(owner, { lists, colors, dayState, isV1, v1TaskKey }) {
    const insertList = db.prepare("INSERT INTO lists (owner, name) VALUES (?, ?)");
    const insertTask = db.prepare(
      "INSERT INTO tasks (list_id, position, text, start_time, end_time) VALUES (?, ?, ?, ?, ?)",
    );
    const insertDay = db.prepare("INSERT OR IGNORE INTO task_days (task_id, day) VALUES (?, ?)");
    const insColor = db.prepare(
      "INSERT INTO list_colors (owner, list_id, color) VALUES (?, ?, ?) " +
        "ON CONFLICT (owner, list_id) DO UPDATE SET color = excluded.color",
    );
    const insState = db.prepare(
      "INSERT OR REPLACE INTO user_task_state (owner, day, task_id) VALUES (?, ?, ?)",
    );

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM lists WHERE owner = ?").run(owner);
      db.prepare("DELETE FROM list_colors WHERE owner = ?").run(owner);
      db.prepare("DELETE FROM list_shares WHERE owner = ?").run(owner);
      db.prepare("DELETE FROM user_task_state WHERE owner = ?").run(owner);

      const listIdByKey = {};
      const oldTaskIdMap = {};
      for (const l of lists) {
        const listId = insertList.run(owner, l.name).lastInsertRowid;
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
        if (listId) insColor.run(owner, listId, color);
      }

      if (isV1) {
        for (const [day, files] of Object.entries(dayState || {})) {
          if (!ALLOWED_DAY_RE.test(day) || !files || typeof files !== "object") continue;
          for (const [file, tasks] of Object.entries(files)) {
            if (!tasks || typeof tasks !== "object") continue;
            for (const [text, done] of Object.entries(tasks)) {
              if (!done) continue;
              const tid = v1TaskKey[file] && v1TaskKey[file][text];
              if (tid) insState.run(owner, day, tid);
            }
          }
        }
      } else {
        for (const [day, tasks] of Object.entries(dayState || {})) {
          if (!ALLOWED_DAY_RE.test(day) || !tasks || typeof tasks !== "object") continue;
          for (const [taskId, done] of Object.entries(tasks)) {
            if (!done) continue;
            const tid = oldTaskIdMap[String(taskId)];
            if (tid) insState.run(owner, day, tid);
          }
        }
      }
    });
    tx();
  },

  /* ---- Seed defaults -------------------------------------------- */

  async seedUserDefaults(ownerId) {
    return _seedUserDefaults(ownerId);
  },
};
