<script setup>
import { computed } from "vue";
import { useTasks } from "../composables/useTasks";
import { addDays, dateKey } from "../utils/date";
import DayCard from "./DayCard.vue";

const { weekStart } = useTasks();

const days = computed(() => {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i));
});
</script>

<template>
  <div class="week">
    <DayCard v-for="(day, i) in days" :key="i" :day="day" :index="i" />
  </div>
</template>