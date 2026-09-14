<script setup>
import { computed } from "vue";
import { useTasks } from "../composables/useTasks";
import { dateKey, sameDay, shortDate, DAY_NAMES } from "../utils/date";
import { taskText, taskOnDay, startMinutes } from "../utils/tasks";
import TaskItem from "./TaskItem.vue";

const props = defineProps({
  day: { type: Date, required: true },
  index: { type: Number, required: true }
});

const { visibleLists, state, toggle, checkedAt, isReadonly, effectiveColor } = useTasks();

const dayKey = computed(() => dateKey(props.day));
const isToday = computed(() => sameDay(props.day, new Date()));

const flatTasks = computed(() => {
  const out = [];
  visibleLists.value.forEach((list) => {
    list.tasks
      .filter((t) => taskOnDay(t, props.index))
      .forEach((task, order) => {
        out.push({ task, listId: list.id, color: effectiveColor(list.id), readonly: isReadonly(list.id), order });
      });
  });
  return out.sort((a, b) => {
    const sa = startMinutes(a.task);
    const sb = startMinutes(b.task);
    if (sa === null && sb === null) return a.order - b.order;
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa - sb;
  });
});

const totalDone = computed(() => {
  let done = 0;
  flatTasks.value.forEach(({ task, listId }) => {
    if (checkedAt(dayKey.value, listId, taskText(task))) {
      done++;
    }
  });
  return { done, total: flatTasks.value.length };
});

const percent = computed(() =>
  totalDone.value.total
    ? Math.round((totalDone.value.done / totalDone.value.total) * 100)
    : 0
);

function onToggle(item, checked) {
  if (item.readonly) return;
  toggle(dayKey.value, item.listId, taskText(item.task), checked);
}
</script>

<template>
  <div :class="['day', { today: isToday }]">
    <div class="day-header">
      <span class="day-name">
        {{ DAY_NAMES[index] }}
      </span>
      <span class="day-date">{{ shortDate(day) }}</span>
    </div>

    <div class="day-progress">
      <div class="progress-row">
        <span class="progress-count"><b>{{ totalDone.done }}</b> / {{ totalDone.total }}</span>
        <span class="progress-percent">{{ percent }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: percent + '%' }"></div>
      </div>
    </div>

    <template v-if="visibleLists.length">
      <ul v-if="flatTasks.length" class="tasks">
        <TaskItem
          v-for="(item, idx) in flatTasks"
          :key="dayKey + '-' + item.listId + '-' + idx"
          :task-key="dayKey + '-' + item.listId + '-' + idx"
          :task="item.task"
          :color="item.color"
          :disabled="item.readonly"
          :checked="checkedAt(dayKey, item.listId, taskText(item.task))"
          @toggle="(val) => onToggle(item, val)"
        />
      </ul>
      <div v-else class="empty">На этот день задач нет.</div>
    </template>

    <template v-else>
      <div class="empty">Выберите хотя бы один список дел.</div>
    </template>
  </div>
</template>