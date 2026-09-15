<script setup>
import { useTasks } from "../composables/useTasks";

const emit = defineEmits(["edit", "add", "share"]);

const { lists, isSelected, toggleList, deleteList, unsubscribe, colors, setColor, resetColor, effectiveColor } = useTasks();

function remove(id, label) {
  if (confirm(`Удалить список «${label}»? Задачи будут стёрты безвозвратно.`)) {
    deleteList(id);
  }
}

function unsub(item) {
  if (confirm(`Отписаться от общего списка «${item.label}»?`)) {
    unsubscribe(item.id);
  }
}
</script>

<template>
  <div class="list-checks">
    <div
      v-for="item in lists"
      :key="item.id"
      class="list-check-wrap"
      :class="{ shared: item.readonly }"
      :style="{ background: effectiveColor(item.id) }"
    >
      <label class="list-check">
        <input
          type="checkbox"
          :checked="isSelected(item.id)"
          @change="toggleList(item.id)"
        />
        {{ item.label }}
        <span v-if="item.readonly" class="shared-badge">общий</span>
      </label>
      <button v-if="item.readonly" class="btn-edit btn-del" title="Отписаться от общего списка" @click="unsub(item)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <template v-if="!item.readonly">
        <input
          type="color"
          class="color-pick"
          :title="'Цвет списка ' + item.label"
          :value="colors[item.id] || '#ffffff'"
          @input="setColor(item.id, $event.target.value)"
        />
        <button v-if="colors[item.id]" class="btn-edit btn-reset" title="Вернуть автоматический цвет" @click="resetColor(item.id)">
          ↺
        </button>
        <button class="btn-edit" :title="'Поделиться списком ' + item.label" @click="emit('share', item.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
        </button>
        <button class="btn-edit" :title="'Редактировать ' + item.label" @click="emit('edit', item.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
          </svg>
        </button>
        <button class="btn-edit btn-del" :title="'Удалить ' + item.label" @click="remove(item.id, item.label)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </template>
    </div>
    <button class="btn-add" title="Добавить список" @click="emit('add')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      Добавить
    </button>
  </div>
</template>