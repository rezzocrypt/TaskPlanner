<script setup>
import { computed, ref } from "vue";
import { useTasks } from "../composables/useTasks";
import { addDays, dateKey, dayIndexFromKey } from "../utils/date";
import { taskText, taskOnDay } from "../utils/tasks";
import "../css/StatsModal.css";

const emit = defineEmits(["close"]);

const { state, visibleLists, weekStart, checkedAt } = useTasks();
const range = ref("week");

const rangeLabel = computed(() => {
  const names = visibleLists.value.map((l) => l.label);
  const sub = range.value === "week" ? "эта неделя" : "всё время";
  return (names.length ? names.join(", ") : "—") + " · " + sub;
});

const relevantDays = computed(() => {
  const today = new Date();
  if (range.value === "week") {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart.value, i);
      if (d <= today) days.push(dateKey(d));
    }
    return days;
  }
  return Object.keys(state).sort();
});

const rows = computed(() => {
  const days = relevantDays.value;
  const out = [];
  visibleLists.value.forEach((list) => {
    list.tasks.forEach((task) => {
      const txt = taskText(task);
      const applicable = days.filter(
        (k) => taskOnDay(task, dayIndexFromKey(k))
      );
      const done = applicable.filter((k) => checkedAt(k, list.id, task)).length;
      out.push({ txt: list.label + " · " + txt, done, total: applicable.length });
    });
  });
  return out.sort((a, b) => {
    const am = a.total - a.done;
    const bm = b.total - b.done;
    return bm - am || a.total - b.total;
  });
});
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">Невыполненные дела</span>
        <button @click="emit('close')" title="Закрыть">✕</button>
      </div>

      <div class="modal-actions">
        <label class="radio">
          <input type="radio" value="week" v-model="range" /> Эта неделя
        </label>
        <label class="radio">
          <input type="radio" value="all" v-model="range" /> Всё время
        </label>
        <span class="modal-list-name">{{ rangeLabel }}</span>
      </div>

      <div class="stats">
        <div v-if="!visibleLists.length" class="s-empty">
          Выберите хотя бы один список дел.
        </div>
        <div v-else-if="!relevantDays.length" class="s-empty">
          Нет данных за выбранный период. Отметьте дела хотя бы в один день.
        </div>
        <div
          v-for="r in rows"
          :key="r.txt"
          :class="['s-row', { bad: r.done === 0 && r.total > 0 }]"
        >
          <div class="s-top">
            <span class="s-name">{{ r.txt }}</span>
            <span :class="['s-total', { bad: r.done === 0 && r.total > 0 }]">
              не сделано {{ r.total - r.done }} из {{ r.total }}
            </span>
          </div>
          <div class="bar">
            <div
              class="bar-fill"
              :style="{ width: r.total ? Math.round((r.done / r.total) * 100) + '%' : '0%' }"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>