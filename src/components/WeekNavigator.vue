<script setup>
import { computed } from "vue";
import { useTasks } from "../composables/useTasks";
import { addDays, shortDate } from "../utils/date";
import "../css/WeekNavigator.css";

const { weekStart, prevWeek, nextWeek, goToday } = useTasks();

const rangeLabel = computed(() => {
  const start = weekStart.value;
  const end = addDays(start, 6);
  return shortDate(start) + " – " + shortDate(end);
});
</script>

<template>
  <div class="nav">
    <button @click="prevWeek" title="Предыдущая неделя">&larr;</button>
    <span class="week-label">{{ rangeLabel }}</span>
    <button @click="nextWeek" title="Следующая неделя">&rarr;</button>
    <button class="btn-today" @click="goToday">Сегодня</button>
  </div>
</template>