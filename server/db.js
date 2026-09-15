import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "weekplan.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    owner      TEXT NOT NULL,
    file       TEXT NOT NULL,
    content    TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (owner, file)
  );

  CREATE TABLE IF NOT EXISTS list_colors (
    owner TEXT NOT NULL,
    file  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (owner, file)
  );

  CREATE TABLE IF NOT EXISTS day_state (
    owner TEXT NOT NULL,
    day   TEXT NOT NULL,
    file  TEXT NOT NULL,
    task  TEXT NOT NULL,
    PRIMARY KEY (owner, day, file, task)
  );

  CREATE TABLE IF NOT EXISTS shares (
    token      TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    file       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (owner, file)
  );

  CREATE TABLE IF NOT EXISTS default_lists (
    file    TEXT PRIMARY KEY,
    content TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_meta (
    owner   TEXT PRIMARY KEY,
    seeded  INTEGER NOT NULL DEFAULT 0
  );
`);

const PLACEHOLDER_NAME = "Новый список";

export function listMeta(file, content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    data = {};
  }
  const rawTasks = Array.isArray(data.tasks)
    ? data.tasks
    : typeof data === "string"
      ? data.split("\n")
      : Array.isArray(data)
        ? data
        : [];
  const slug = String(file).split("/").pop().replace(/\.json$/i, "");
  const label =
    data && typeof data.name === "string" && data.name.trim() && data.name !== PLACEHOLDER_NAME
      ? data.name
      : slug;
  const tasks = rawTasks
    .filter((t) => {
      if (typeof t === "string") return t.trim() !== "";
      if (t && typeof t === "object") return String(t.text || "").trim() !== "";
      return false;
    })
    .map((t) => {
      if (typeof t === "string") return t;
      return { ...t, text: String(t.text || "") };
    });
  return { id: file, label, tasks, raw: content };
}

export function seedDefaultsIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM default_lists").get().n;
  if (count > 0) return;
  const seedPath = path.join(__dirname, "seed", "default-lists.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  } catch (e) {
    return;
  }
  const insert = db.prepare("INSERT OR IGNORE INTO default_lists (file, content) VALUES (?, ?)");
  const items = Array.isArray(data.defaultLists) ? data.defaultLists : [];
  const tx = db.transaction(() => {
    for (const item of items) {
      if (!item || !item.file) continue;
      const content =
        typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2);
      insert.run(item.file, content);
    }
  });
  tx();
}

export function seedUserDefaults(uid) {
  const meta = db.prepare("SELECT seeded FROM user_meta WHERE owner = ?").get(uid);
  if (meta && meta.seeded) return false;
  db.prepare("INSERT INTO user_meta (owner, seeded) VALUES (?, 1) ON CONFLICT (owner) DO UPDATE SET seeded = 1").run(uid);
  const rows = db.prepare("SELECT file, content FROM default_lists ORDER BY rowid").all();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO lists (owner, file, content) VALUES (?, ?, ?)"
  );
  const tx = db.transaction(() => {
    for (const row of rows) insert.run(uid, row.file, row.content);
  });
  tx();
  return rows.length > 0;
}

export default db;