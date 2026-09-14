<script setup>
import { onMounted, ref } from "vue";
import { useTasks } from "../composables/useTasks";

const props = defineProps({
  listId: { type: String, required: true }
});
const emit = defineEmits(["close"]);

const { shareList, revokeShare, shares } = useTasks();
const url = ref("");
const error = ref("");
const copied = ref(false);
const info = ref("");

onMounted(async () => {
  try {
    const r = await shareList(props.listId);
    url.value = r.url;
  } catch (e) {
    error.value = e.message;
  }
});

async function copy() {
  try {
    await navigator.clipboard.writeText(url.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch (e) {
    error.value = "Не удалось скопировать: " + e.message;
  }
}

async function revoke() {
  await revokeShare(props.listId);
  emit("close");
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal modal-edit">
      <div class="modal-head">
        <span class="modal-title">Поделиться списком</span>
        <button @click="emit('close')" title="Закрыть">✕</button>
      </div>

      <div class="editor-body">
        <div v-if="error" class="editor-error">{{ error }}</div>
        <template v-else>
          <p class="share-note">
            По этой ссылке любой сможет <b>просматривать</b> список (копия для чтения). Изменения в исходном списке обновятся по той же ссылке.
          </p>
          <div class="share-row">
            <input class="field-input" :value="url" readonly @focus="$event.target.select()" />
            <button class="btn-primary" @click="copy" :disabled="!url">{{ copied ? "Скопировано" : "Скопировать" }}</button>
          </div>
          <div v-if="info" class="editor-error">{{ info }}</div>
        </template>
      </div>

      <div class="modal-actions editor-footer">
        <span class="editor-hint">Отозвав доступ, вы удалите публичную копию.</span>
        <div class="editor-btns">
          <button v-if="!error && shares[listId]" class="btn-danger" @click="revoke">Отозвать доступ</button>
          <button @click="emit('close')">Закрыть</button>
        </div>
      </div>
    </div>
  </div>
</template>