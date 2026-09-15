<script setup>
import { computed, ref, onMounted } from "vue";
import { useTasks } from "./composables/useTasks";
import { useAuth } from "./composables/useAuth";
import ListSelector from "./components/ListSelector.vue";
import WeekNavigator from "./components/WeekNavigator.vue";
import WeekGrid from "./components/WeekGrid.vue";
import StatsModal from "./components/StatsModal.vue";
import EditListModal from "./components/EditListModal.vue";
import AddListModal from "./components/AddListModal.vue";
import ShareModal from "./components/ShareModal.vue";
import AuthForm from "./components/AuthForm.vue";
import logo from "./assets/logo.png";
import "./css/App.css";

const { error, loadLists, buildBackup, restoreBackup, attachShared } = useTasks();
const { user, load: loadAuth, logout } = useAuth();
const showStats = ref(false);
const editingId = ref(null);
const showAdd = ref(false);
const sharingId = ref(null);
const backupInput = ref(null);
const backupMsg = ref("");
const pendingShare = ref("");

const loggedIn = computed(() => !!(user.value && user.value.email));

onMounted(async () => {
  await loadAuth();
  const t = new URLSearchParams(location.search).get("share") || "";
  if (t) {
    pendingShare.value = t;
    const url = new URL(location.href);
    url.search = "";
    history.replaceState({}, "", url.href);
  }
  if (loggedIn.value) {
    await loadLists();
    await finishPendingShare();
  }
});

async function finishPendingShare() {
  const t = pendingShare.value;
  if (!t) return;
  pendingShare.value = "";
  await attachShared(t);
}

async function onAuthDone() {
  await loadLists();
  await finishPendingShare();
}

async function onLogout() {
  await logout();
  pendingShare.value = "";
}

function downloadBackup() {
  const data = buildBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "weekstreak-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function onRestore(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    await restoreBackup(JSON.parse(text));
    backupMsg.value = "Бэкап восстановлен.";
  } catch (err) {
    backupMsg.value = "Ошибка восстановления: " + err.message;
  }
}
</script>

<template>
  <div class="page">
    <header>
      <div class="title-block">
        <img class="logo" :src="logo" alt="WeekStreak" />
        <h1>WeekStreak</h1>
      </div>
      <div class="header-right" v-if="loggedIn">
        <div class="auth-area">
          <span class="auth-email" :title="user.email">{{ user.email }}</span>
          <button class="btn-ghost" @click="onLogout">Выйти</button>
        </div>
        <WeekNavigator />
        <button class="btn-stats" @click="showStats = true">
          <svg class="stats-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          Статистика
        </button>
      </div>
    </header>

    <template v-if="loggedIn">
      <div class="sources-bar">
        <span class="sources-label">Источники:</span>
        <ListSelector @edit="(id) => (editingId = id)" @add="showAdd = true" @share="(id) => (sharingId = id)" />
        <div class="backup-actions">
          <button class="btn-ghost" title="Скачать копию списков и галочек" @click="downloadBackup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Бэкап
          </button>
          <button class="btn-ghost" title="Восстановить списки и галочки из файла бэкапа" @click="backupInput.click()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Восстановить
          </button>
          <input ref="backupInput" type="file" accept=".json,application/json" style="display: none" @change="onRestore" />
        </div>
      </div>

      <div v-if="backupMsg" class="error info">{{ backupMsg }}</div>

      <div v-if="error" class="error" v-html="error"></div>

      <WeekGrid />

      <StatsModal v-if="showStats" @close="showStats = false" />

      <EditListModal v-if="editingId" :list-id="editingId" @close="editingId = null" />

      <AddListModal v-if="showAdd" @close="showAdd = false" />

      <ShareModal v-if="sharingId" :list-id="sharingId" @close="sharingId = null" />
    </template>

    <template v-else>
      <div class="auth-screen">
        <div class="auth-screen-card">
          <h2 class="auth-screen-title">Войдите, чтобы увидеть свои списки</h2>
          <p class="auth-screen-sub">Списки задач и отметки доступны только после входа. Зарегистрируйтесь, если у вас ещё нет учётной записи.</p>
          <AuthForm @done="onAuthDone" />
        </div>
      </div>
    </template>
  </div>
</template>