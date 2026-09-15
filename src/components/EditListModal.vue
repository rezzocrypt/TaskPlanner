<script setup>
import { computed, ref } from "vue";
import { useTasks } from "../composables/useTasks";
import ListEditor from "./ListEditor.vue";

const props = defineProps({
  listId: { type: String, required: true }
});
const emit = defineEmits(["close"]);

const { metas, saveList } = useTasks();
const editor = ref(null);
const error = ref("");

const initialData = computed(() => {
  const m = metas[props.listId];
  return m ? { name: m.label, tasks: m.tasks } : { name: "", tasks: [] };
});

const title = computed(() => {
  const m = metas[props.listId];
  return m ? m.label : props.listId;
});

async function save() {
  let data;
  try {
    data = editor.value.getData();
  } catch (e) {
    error.value = "Ошибка: " + e.message;
    return;
  }
  try {
    await saveList(props.listId, data);
    emit("close");
  } catch (e) {
    error.value = "Ошибка сохранения: " + e.message;
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal modal-edit">
      <div class="modal-head">
        <span class="modal-title">Редактирование: {{ title }}</span>
        <button @click="emit('close')" title="Закрыть">✕</button>
      </div>

      <div class="editor-body">
        <ListEditor :key="listId" ref="editor" :initial="initialData" />
        <div v-if="error" class="editor-error">{{ error }}</div>
      </div>

      <div class="modal-actions editor-footer">
        <span class="editor-hint">Время и выбранные дни показываются в сетке недели; без выбора дней задача показывается каждый день.</span>
        <div class="editor-btns">
          <button class="btn-primary" @click="save">Сохранить</button>
          <button @click="emit('close')">Отмена</button>
        </div>
      </div>
    </div>
  </div>
</template>