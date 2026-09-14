<script setup>
import { ref, watch } from "vue";
import { useTasks } from "../composables/useTasks";

const props = defineProps({
  listId: { type: String, required: true }
});
const emit = defineEmits(["close"]);

const { metas, saveList } = useTasks();
const content = ref("");
const error = ref("");

watch(
  () => props.listId,
  (id) => {
    content.value = metas[id] ? metas[id].raw : "";
    error.value = "";
  },
  { immediate: true }
);

async function save() {
  try {
    await saveList(props.listId, content.value);
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
        <textarea v-model="content" spellcheck="false"></textarea>
        <div v-if="error" class="editor-error">{{ error }}</div>
      </div>

      <div class="modal-actions editor-footer">
        <span class="editor-hint">Формат: {{ '{ "name": "...", "tasks": ["дело", { "text": "...", "start": "09:00", "end": "10:00", "days": [0, 2] }] } — days: 0=пн … 6=вс, без days — каждый день' }}</span>
        <div class="editor-btns">
          <button class="btn-primary" @click="save">Сохранить</button>
          <button @click="emit('close')">Отмена</button>
        </div>
      </div>
    </div>
  </div>
</template>