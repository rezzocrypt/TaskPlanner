import { describe, before, after, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { ApiClient, startServer, stopServer } from "./helpers.js";

function createLegacyDb(dbPath) {
  const d = new Database(dbPath);
  d.exec(`
    CREATE TABLE users (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      uid   TEXT NOT NULL,
      email TEXT,
      password TEXT
    );
    CREATE TABLE sessions (
      token     TEXT PRIMARY KEY,
      user_id   INTEGER,
      created_at INTEGER,
      expires_at INTEGER
    );
    CREATE TABLE lists (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      owner   TEXT NOT NULL,
      name    TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO users (uid, email, password) VALUES ('legacy1', 'old@test.dev', 'irrelevant');
    INSERT INTO lists (owner, name, content) VALUES ('legacy1', 'Старый', '{"name":"Старый","tasks":["Забытая задача"]}');
  `);
  d.close();
}

describe("миграция со старой схемы (uid + content)", () => {
  let srv;
  let api;
  const dbPath = path.join(os.tmpdir(), "weekplan-migrate-" + Date.now() + ".db");

  before(async () => {
    createLegacyDb(dbPath);
    srv = await startServer({ dbPath });
    api = new ApiClient(srv.base);
  });
  after(async () => {
    await stopServer(srv);
    try {
      const fs = await import("node:fs");
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(dbPath + "-wal", { force: true });
      fs.rmSync(dbPath + "-shm", { force: true });
    } catch (e) {}
  });

  test("сервер стартует на старой БД — миграция прошла", async () => {
    const me = await api.post("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.json.anonymous, true, "анонимный доступ работает");
  });

  test("регистрация нового пользователя после миграции", async () => {
    const r = await api.post("/api/register", { email: "fresh@test.dev", password: "secret1" });
    assert.equal(r.status, 201);
    assert.ok(r.json.id > 0);
  });

  test("начальные списки создаются заново после миграции", async () => {
    const lists = (await api.get("/api/lists")).json.lists;
    assert.equal(lists.length, 2);
    const labels = lists.map((l) => l.label).sort();
    assert.deepEqual(labels, ["Задачи", "Увлечения"]);
    const det = await api.get("/api/lists/" + lists[0].id);
    assert.ok(det.json.tasks.length > 0, "задачи засеяны");
  });
});
