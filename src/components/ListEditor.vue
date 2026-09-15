<script setup>
import { ref } from "vue";
import { DAY_NAMES } from "../utils/date";
import "../css/ListEditor.css";

const props = defineProps({
  initial: { type: [String, Object], default: "" }
});

const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function allDays() {
  return Array(7).fill(true);
}

function dayArray(days) {
  const arr = allDays();
  if (Array.isArray(days) && days.length) {
    arr.fill(false);
    for (const d of days) {
      const n = Number(d);
      if (Number.isInteger(n) && n >= 0 && n <= 6) arr[n] = true;
    }
  }
  return arr;
}

function parseTask(t) {
  if (typeof t === "string") return { id: null, text: t, start: "", end: "", days: allDays() };
  const o = t && typeof t === "object" ? t : {};
  return {
    id: Number.isInteger(Number(o.id)) ? Number(o.id) : null,
    text: String(o.text || ""),
    start: String(o.start || ""),
    end: String(o.end || ""),
    days: dayArray(o.days)
  };
}

function parseInitialData() {
  let parsed = props.initial;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed || "{}");
    } catch (e) {
      parsed = {};
    }
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return {
      name: String(parsed.name || ""),
      tasks: (Array.isArray(parsed.tasks) ? parsed.tasks : []).map(parseTask)
    };
  }
  if (Array.isArray(parsed)) {
    return { name: "", tasks: parsed.map(parseTask) };
  }
  return { name: "", tasks: [] };
}

const initialData = parseInitialData();
const name = ref(initialData.name);
const tasks = ref(initialData.tasks);

function addTask() {
  tasks.value.push({ id: null, text: "", start: "", end: "", days: allDays() });
}

function removeTask(i) {
  tasks.value.splice(i, 1);
}

function toggleDay(row, di) {
  row.days[di] = !row.days[di];
}

function dayIdxs(row) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    if (row.days[i]) out.push(i);
  }
  return out;
}

function serializeRow(row) {
  const text = row.text.trim();
  const days = dayIdxs(row);
  const partial = days.length > 0 && days.length < 7;
  const task = { text };
  if (row.id != null) task.id = row.id;
  if (row.start) task.start = row.start;
  if (row.end) task.end = row.end;
  if (partial) task.days = days;
  return task;
}

function getData() {
  const out = [];
  let empty = false;
  for (const row of tasks.value) {
    if (!row.text.trim()) {
      empty = true;
      continue;
    }
    out.push(serializeRow(row));
  }
  if (empty) {
    throw new Error("Есть задача без названия: впишите текст или удалите строку.");
  }
  return { name: name.value.trim(), tasks: out };
}

defineExpose({ getData, name, tasks, addTask, removeTask });
</script>

<template>
  <div class="list-editor">
    <label class="field-label" for="list-name">Название списка</label>
    <input id="list-name" class="field-input list-name-input" v-model="name" placeholder="Название списка" />

    <div class="field-label task-form-head">Задачи <span class="task-form-note">время и дни — по желанию; без выбора дней задача показывается каждый день</span></div>

    <div v-if="!tasks.length" class="empty task-empty">Задач пока нет. Добавьте первую ниже.</div>

    <div class="task-form-list">
      <div v-for="(row, i) in tasks" :key="i" class="task-form-row">
        <div class="task-text-row">
          <input class="field-input task-text-input" v-model="row.text" :placeholder="'Задача ' + (i + 1)" />
          <button type="button" class="btn-edit btn-del" :title="'Удалить задачу ' + (i + 1)" @click="removeTask(i)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="task-options-row">
          <label class="time-field">
            <span>Начало</span>
            <input type="time" v-model="row.start" />
          </label>
          <label class="time-field">
            <span>Конец</span>
            <input type="time" v-model="row.end" />
          </label>
          <div class="days-field">
            <span class="days-label">Дни:</span>
            <button
              v-for="(d, di) in DAY_SHORT"
              :key="di"
              type="button"
              :class="['day-chip', { on: row.days[di] }]"
              :title="DAY_NAMES[di]"
              @click="toggleDay(row, di)"
            >{{ d }}</button>
          </div>
        </div>
      </div>
    </div>

    <button type="button" class="btn-add task-add" @click="addTask">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      Добавить задачу
    </button>
  </div>
</template>