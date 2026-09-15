import { describe, before, after, test } from "node:test";
import assert from "node:assert/strict";
import { taskOnDay } from "../src/utils/tasks.js";
import { ApiClient, startServer, stopServer } from "./helpers.js";

describe("weekplan API", () => {
  let srv;
  let api;
  before(async () => {
    srv = await startServer();
    api = new ApiClient(srv.base);
  });
  after(async () => stopServer(srv));

  /* ── анонимный доступ ─────────────────────────────── */

  test("POST /api/me — анонимный ответ", async () => {
    const r = await api.post("/api/me");
    assert.equal(r.status, 200);
    assert.equal(r.json.id, null);
    assert.equal(r.json.email, null);
    assert.equal(r.json.anonymous, true);
  });

  test("прямой переход к защищённым маршрутам — 401", async () => {
    for (const path of ["/api/lists", "/api/state", "/api/backup"]) {
      const r = await api.get(path);
      assert.equal(r.status, 401, `${path} expected 401 got ${r.status}`);
    }
  });

  /* ── регистрация ───────────────────────────────────── */

  test("регистрация — некорректные данные", async () => {
    const bad = await api.post("/api/register", { email: "nope", password: "123" });
    assert.equal(bad.status, 400);
    const noPass = await api.post("/api/register", { email: "a@b.c", password: "short" });
    assert.equal(noPass.status, 400);
  });

  test("регистрация — успешная", async () => {
    const r = await api.post("/api/register", { email: "alice@test.dev", password: "secret1" });
    assert.equal(r.status, 201);
    assert.ok(r.json.id > 0);
    assert.equal(r.json.email, "alice@test.dev");
    const me = await api.post("/api/me");
    assert.equal(me.json.id, r.json.id);
  });

  test("дублирующий email — 409", async () => {
    const r = await api.post("/api/register", { email: "alice@test.dev", password: "secret1" });
    assert.equal(r.status, 409);
  });

  /* ── логаут / логин ────────────────────────────────── */

  test("логаут и повторный вход", async () => {
    await api.post("/api/logout");
    const me = await api.post("/api/me");
    assert.equal(me.json.anonymous, true);

    const wrong = await api.post("/api/login", { email: "alice@test.dev", password: "wrong" });
    assert.equal(wrong.status, 401);

    const ok = await api.post("/api/login", { email: "alice@test.dev", password: "secret1" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.id > 0, true);
  });

  /* ── списки по умолчанию ───────────────────────────── */

  test("GET /api/lists — два начальных списка", async () => {
    const r = await api.get("/api/lists");
    assert.equal(r.status, 200);
    assert.equal(r.json.lists.length, 2);
    const labels = r.json.lists.map((l) => l.label).sort();
    assert.deepEqual(labels, ["Задачи", "Увлечения"]);
    for (const l of r.json.lists) {
      assert.equal(typeof l.id, "number");
      assert.equal(l.readonly, false);
    }
  });

  test("GET /api/lists/:id — задачи и дни", async () => {
    const lists = (await api.get("/api/lists")).json.lists;
    for (const l of lists) {
      const det = await api.get("/api/lists/" + l.id);
      assert.equal(det.status, 200);
      assert.ok(det.json.tasks.length > 0, "список должен содержать задачи");
      for (const t of det.json.tasks) {
        assert.equal(typeof t.id, "number");
        assert.equal(typeof t.text, "string");
        assert.ok(t.text.length > 0);
        assert.ok(
          t.days === null || (Array.isArray(t.days) && t.days.length > 0 && t.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
          "days должен быть null или массивом из 0..6: " + JSON.stringify(t)
        );
      }
    }
  });

  test("predicate: задачи без дней видны все 7 дней", async () => {
    const lists = (await api.get("/api/lists")).json.lists;
    const allTasks = (await Promise.all(lists.map((l) => api.get("/api/lists/" + l.id)))).flatMap((r) => r.json.tasks);
    for (let day = 0; day < 7; day++) {
      for (const t of allTasks) {
        if (t.days === null) {
          assert.ok(taskOnDay(t, day), `null-days task "${t.text}" should be visible on day ${day}`);
        }
      }
    }
  });

  test("predicate: задачи с явными днями видны только в указанные", async () => {
    const lists = (await api.get("/api/lists")).json.lists;
    const allTasks = (await Promise.all(lists.map((l) => api.get("/api/lists/" + l.id)))).flatMap((r) => r.json.tasks);
    for (const t of allTasks) {
      if (Array.isArray(t.days)) {
        for (let day = 0; day < 7; day++) {
          const expected = t.days.includes(day);
          assert.equal(taskOnDay(t, day), expected, `"${t.text}" on day ${day} expected ${expected}`);
        }
      }
    }
  });

  /* ── CRUD списков ────────────────────────────────────── */

  let newListId;
  test("POST /api/lists — создание нового списка", async () => {
    const r = await api.post("/api/lists", {
      name: "Тестовый",
      tasks: [
        { text: "Ежедневная", start: "", end: "" },
        { text: "Только понедельник", start: "", end: "", days: [0] },
        "Просто строка"
      ]
    });
    assert.equal(r.status, 201);
    assert.ok(r.json.id > 0);
    assert.equal(r.json.name, "Тестовый");
    newListId = r.json.id;
    const det = await api.get("/api/lists/" + newListId);
    assert.equal(det.json.tasks.length, 3);
    const sorted = det.json.tasks.slice().sort((a, b) => a.id - b.id);
    assert.ok(sorted[0].days === null, "каждый день → days null");
    assert.deepEqual(sorted[1].days, [0]);
    assert.ok(sorted[2].days === null);
    for (const t of det.json.tasks) assert.ok(t.id > 0, "task id должен быть числом");
  });

  test("PUT /api/lists/:id — частичное обновление с сохранением id", async () => {
    const before = (await api.get("/api/lists/" + newListId)).json;
    const keepIds = before.tasks.slice(0, 2).map((t) => ({ id: t.id, text: t.text, start: t.start, end: t.end, days: t.days }));
    const r = await api.put("/api/lists/" + newListId, {
      name: "Тестовый (обновлён)",
      tasks: [...keepIds, { text: "Новая задача" }]
    });
    assert.equal(r.status, 200);
    const after = (await api.get("/api/lists/" + newListId)).json;
    assert.equal(after.name, "Тестовый (обновлён)");
    assert.equal(after.tasks.length, 3);
    const ids = after.tasks.map((t) => t.id).sort((a, b) => a - b);
    const origIds = before.tasks.slice(0, 2).map((t) => t.id).sort((a, b) => a - b);
    assert.deepEqual(ids.slice(0, 2), origIds, "старые id должны сохраниться");
    const added = after.tasks.find((t) => t.text === "Новая задача");
    assert.ok(added, "новая задача добавлена");
    assert.equal(added.days, null);
    assert.ok(!after.tasks.some((t) => t.text === "Просто строка"), "удалённая задача исчезла");
  });

  test("PUT с пустым именем — 400; несуществующий список — 404", async () => {
    const badName = await api.put("/api/lists/" + newListId, { name: "", tasks: [] });
    assert.equal(badName.status, 400);
    const notFound = await api.put("/api/lists/99999", { name: "X", tasks: [] });
    assert.equal(notFound.status, 404);
  });

  test("DELETE /api/lists/:id", async () => {
    const r = await api.del("/api/lists/" + newListId);
    assert.equal(r.status, 200);
    assert.ok(r.json.ok);
    const get = await api.get("/api/lists/" + newListId);
    assert.equal(get.status, 404);
  });

  /* ── состояние галочек ──────────────────────────────── */

  let toggleListId;
  let toggleTaskId;
  const stateDay = "2026-09-14"; // понедельник

  test("POST /api/state/toggle — установка и сброс", async () => {
    const lists = (await api.get("/api/lists")).json.lists;
    toggleListId = lists[0].id;
    const det = await api.get("/api/lists/" + toggleListId);
    toggleTaskId = det.json.tasks.find((t) => t.days === null)?.id ?? det.json.tasks[0].id;

    const badDay = await api.post("/api/state/toggle", { day: "bad", taskId: toggleTaskId, done: true });
    assert.equal(badDay.status, 400);
    const badTask = await api.post("/api/state/toggle", { day: stateDay, taskId: "xxx", done: true });
    assert.equal(badTask.status, 400);

    const on = await api.post("/api/state/toggle", { day: stateDay, taskId: toggleTaskId, done: true });
    assert.equal(on.status, 200);
    assert.ok(on.json.ok);

    const st = await api.get("/api/state");
    assert.ok(st.json.state[stateDay]?.[toggleTaskId], "галочка должна появиться");

    const off = await api.post("/api/state/toggle", { day: stateDay, taskId: toggleTaskId, done: false });
    assert.equal(off.status, 200);
    const st2 = await api.get("/api/state");
    assert.ok(!st2.json.state[stateDay]?.[toggleTaskId], "галочка должна исчезнуть");
  });

  test("toggle чужой задачи — 404", async () => {
    const r = await api.post("/api/state/toggle", { day: stateDay, taskId: 999999, done: true });
    assert.equal(r.status, 404);
  });

  /* ── цвета ───────────────────────────────────────────── */

  test("PUT /api/lists/:id/color", async () => {
    const lists = (await api.get("/api/lists")).json.lists;
    const id = lists[0].id;
    const set = await api.put("/api/lists/" + id + "/color", { color: "#abc123" });
    assert.equal(set.status, 200);
    assert.equal(set.json.color, "#abc123");
    const after = (await api.get("/api/lists")).json.lists.find((l) => l.id === id);
    assert.equal(after.color, "#abc123");
    const reset = await api.put("/api/lists/" + id + "/color", { color: "" });
    assert.equal(reset.json.color, "");
  });

  /* ── изоляция пользователей ─────────────────────────── */

  test("другой пользователь — свои списки, чужие 404", async () => {
    const bob = new ApiClient(srv.base);
    const reg = await bob.post("/api/register", { email: "bob@test.dev", password: "secret1" });
    assert.equal(reg.status, 201);
    const lists = (await bob.get("/api/lists")).json.lists;
    assert.equal(lists.length, 2, "bob тоже получает 2 списка");
    const notBob = (await api.get("/api/lists")).json.lists;
    const r = await bob.get("/api/lists/" + notBob[0].id);
    assert.equal(r.status, 404);
    const toggle = await bob.post("/api/state/toggle", { day: stateDay, taskId: toggleTaskId, done: true });
    assert.equal(toggle.status, 404);
  });

  /* ── шаринг ─────────────────────────────────────────── */

  let shareToken;
  let sharedListId;
  test("POST /api/shares — создание шаринга", async () => {
    const lists = (await api.get("/api/lists")).json.lists;
    sharedListId = lists[0].id;
    const r = await api.post("/api/shares", { listId: sharedListId });
    assert.equal(r.status, 200);
    assert.ok(r.json.token);
    shareToken = r.json.token;
  });

  test("GET /api/shares/:token — публичный доступ", async () => {
    const anon = new ApiClient(srv.base);
    const r = await anon.get("/api/shares/" + shareToken);
    assert.equal(r.status, 200);
    assert.ok(r.json.name);
    assert.ok(r.json.owner);
    assert.ok(Array.isArray(r.json.tasks));
    assert.ok(r.json.tasks.length > 0);
  });

  test("GET /api/shares/:token — неверный токен 404", async () => {
    const r = await api.get("/api/shares/xxxxxxxxxx");
    assert.equal(r.status, 404);
  });

  test("DELETE /api/shares/:id — отзыв шаринга", async () => {
    const r = await api.del("/api/shares/" + sharedListId);
    assert.equal(r.status, 200);
    const anon = new ApiClient(srv.base);
    const get = await anon.get("/api/shares/" + shareToken);
    assert.equal(get.status, 404);
  });

  test("GET /api/users/:id/state — публичное состояние", async () => {
    const me = await api.post("/api/me");
    const r = await api.get("/api/users/" + me.json.id + "/state");
    assert.equal(r.status, 200);
    assert.ok(typeof r.json.state === "object");
    const bad = await api.get("/api/users/99999/state");
    assert.equal(bad.status, 404);
    const invalid = await api.get("/api/users/abc/state");
    assert.equal(invalid.status, 400);
  });

  /* ── бэкап и восстановление ─────────────────────────── */

  test("GET /api/backup — структура", async () => {
    const r = await api.get("/api/backup");
    assert.equal(r.status, 200);
    assert.equal(r.json.app, "weekplan");
    assert.equal(r.json.version, 2);
    assert.ok(Array.isArray(r.json.lists));
    assert.ok(r.json.lists.length > 0);
    assert.ok(typeof r.json.dayState === "object");
    assert.ok(typeof r.json.colors === "object");
  });

  test("POST /api/restore — полный цикл с маппингом id", async () => {
    // галочка на существующей задаче перед восстановлением
    const oldLists = (await api.get("/api/lists")).json.lists;
    const oldDet = (await api.get("/api/lists/" + oldLists[0].id)).json;
    const oldTaskId = oldDet.tasks[0].id;
    const on = await api.post("/api/state/toggle", { day: stateDay, taskId: oldTaskId, done: true });
    assert.equal(on.status, 200);

    const backup = {
      app: "weekplan",
      version: 2,
      createdAt: new Date().toISOString(),
      lists: [
        {
          id: oldLists[0].id,
          name: "Восстановленный",
          tasks: [
            { id: 111, text: "Восстановленная задача", start: "", end: "", days: [] },
            { id: 112, text: "С днём", start: "", end: "", days: [2, 4] }
          ]
        }
      ],
      dayState: { [stateDay]: { 111: true } },
      colors: { [oldLists[0].id]: "#ff0000" }
    };
    const r = await api.post("/api/restore", backup);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.lists, 1);

    const afterLists = (await api.get("/api/lists")).json.lists;
    assert.equal(afterLists.length, 1);
    const newId = afterLists[0].id;
    assert.notEqual(newId, oldLists[0].id, "новый id списка");
    assert.equal(afterLists[0].label, "Восстановленный");
    assert.equal(afterLists[0].color, "#ff0000");

    const det = (await api.get("/api/lists/" + newId)).json;
    assert.equal(det.tasks.length, 2);
    const restoredTask = det.tasks.find((t) => t.text === "Восстановленная задача");
    assert.ok(restoredTask, "задача восстановлена");
    assert.ok(restoredTask.id > 0, "id перемаплен");
    assert.equal(restoredTask.days, null, "каждый день → null");

    const dayTask = det.tasks.find((t) => t.text === "С днём");
    assert.deepEqual(dayTask.days, [2, 4]);

    const st = (await api.get("/api/state")).json.state;
    assert.ok(st[stateDay]?.[restoredTask.id], "галочка перемаплилась на новый id");
  });

  test("POST /api/restore — v1 формат", async () => {
    const v1 = {
      app: "weekplan",
      version: 1,
      lists: [
        {
          file: "old.json",
          content: JSON.stringify({ name: "Старый", tasks: ["Задача А", "Задача Б"] })
        }
      ],
      dayState: { "2026-09-15": { "old.json": { "Задача А": true } } }
    };
    const r = await api.post("/api/restore", v1);
    assert.equal(r.status, 200);
    const lists = (await api.get("/api/lists")).json.lists;
    assert.equal(lists.length, 1);
    assert.equal(lists[0].label, "Старый");
    const det = (await api.get("/api/lists/" + lists[0].id)).json;
    assert.equal(det.tasks.length, 2);
    const st = (await api.get("/api/state")).json.state;
    const aTask = det.tasks.find((t) => t.text === "Задача А");
    assert.ok(st["2026-09-15"]?.[aTask.id], "v1-галочка перемаплена");
  });

  test("POST /api/restore — пустой бэкап 400", async () => {
    const r = await api.post("/api/restore", { lists: [] });
    assert.equal(r.status, 400);
  });
});
