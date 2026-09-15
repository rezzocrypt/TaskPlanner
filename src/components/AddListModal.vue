<script setup>
import { ref } from "vue";
import { useTasks } from "../composables/useTasks";
import ListEditor from "./ListEditor.vue";

const emit = defineEmits(["close"]);

const { addList } = useTasks();
const editor = ref(null);
const error = ref("");

const initialData = {
  name: "Список дел",
  tasks: [
    { text: "Первое дело", start: "09:00", end: "10:00" }
  ]
};

async function create() {
  let data;
  try {
    data = editor.value.getData();
  } catch (e) {
    error.value = e.message;
    return;
  }
  try {
    await addList(data);
    emit("close");
  } catch (e) {
    error.value = e.message;
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal modal-edit">
      <div class="modal-head">
        <span class="modal-title">Новый список дел</span>
        <button @click="emit('close')" title="Закрыть">✕</button>
      </div>

      <div class="editor-body">
        <ListEditor ref="editor" :initial="initialData" />
        <div v-if="error" class="editor-error">{{ error }}</div>
      </div>

      <div class="modal-actions editor-footer">
        <span class="editor-hint">Время и выбранные дни показываются в сетке недели; без выбора дней задача показывается каждый день.</span>
        <div class="editor-btns">
          <button class="btn-primary" @click="create">Создать</button>
          <button @click="emit('close')">Отмена</button>
        </div>
      </div>
    </div>
  </div>
</template>