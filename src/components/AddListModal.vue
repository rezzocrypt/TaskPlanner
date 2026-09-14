<script setup>
import { ref } from "vue";
import { useTasks } from "../composables/useTasks";

const emit = defineEmits(["close"]);

const { addList } = useTasks();
const content = ref(JSON.stringify({
  name: "Список дел",
  tasks: [
    { text: "Первое дело", start: "09:00", end: "10:00" }
  ]
}, null, 2));
const error = ref("");

function randomListName() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  if (window.crypto && crypto.getRandomValues) {
    out = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => chars[b % chars.length]).join("");
  } else {
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  }
  return "list-" + out + ".json";
}

async function create() {
  try {
    await addList(randomListName(), content.value);
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
        <label class="field-label" for="new-list-json">Содержимое (JSON)</label>
        <textarea id="new-list-json" v-model="content" spellcheck="false"></textarea>
        <div v-if="error" class="editor-error">{{ error }}</div>
      </div>

      <div class="modal-actions editor-footer">
        <span class="editor-hint">days: 0=пн … 6=вс, без days — каждый день</span>
        <div class="editor-btns">
          <button class="btn-primary" @click="create">Создать</button>
          <button @click="emit('close')">Отмена</button>
        </div>
      </div>
    </div>
  </div>
</template>