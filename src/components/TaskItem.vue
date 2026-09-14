<script setup>
import { computed } from "vue";
import { taskText, taskTime } from "../utils/tasks";

const props = defineProps({
  taskKey: { type: String, required: true },
  task: { type: [String, Object], required: true },
  checked: { type: Boolean, default: false },
  color: { type: String, default: "#f2f7ff" },
  disabled: { type: Boolean, default: false }
});

const emit = defineEmits(["toggle"]);

const text = computed(() => taskText(props.task));
const time = computed(() => taskTime(props.task));

const sourceStyle = computed(() => ({
  background: props.color
}));
</script>

<template>
  <li :style="sourceStyle" :class="{ readonly: disabled }">
    <input
      type="checkbox"
      :id="taskKey"
      :checked="checked"
      :disabled="disabled"
      @change="emit('toggle', $event.target.checked)"
    />
    <label :for="taskKey">
      <span class="task-text" :title="text">{{ text }}</span>
      <span v-if="time" class="time">{{ time }}</span>
    </label>
  </li>
</template>