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

const initialContent = computed(() =>
  metas[props.listId] ? metas[props.listId].raw : ""
);

async function save() {
  let content;
  try {
    content = editor.value.getContent();
  } catch (e) {
    error.value = "Ошибка: " + e.message;
    return;
  }
  try {
    await saveList(props.listId, content);
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
        <span class="modal-title">Редактирование: {{ listId }}</span>
        <button @click="emit('close')" title="Закрыть">✕</button>
      </div>

      <div class="editor-body">
        <ListEditor :key="listId" ref="editor" :initial="initialContent" />
        <div v-if="error" class="editor-error">{{ error }}</div>
      </div>

      <div class="modal-actions editor-footer">
        <span class="editor-hint">Задача без времени — простая строка; время и выбранные дни показываются в сетке недели.</span>
        <div class="editor-btns">
          <button class="btn-primary" @click="save">Сохранить</button>
          <button @click="emit('close')">Отмена</button>
        </div>
      </div>
    </div>
  </div>
</template>