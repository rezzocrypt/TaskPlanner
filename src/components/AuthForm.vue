<script setup>
import { ref } from "vue";
import { useAuth } from "../composables/useAuth";
import "../css/AuthForm.css";

const props = defineProps({
  initialMode: { type: String, default: "login" }
});

const emit = defineEmits(["done"]);

const { register, login } = useAuth();
const mode = ref(props.initialMode);
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function switchMode(m) {
  mode.value = m;
  error.value = "";
}

async function submit() {
  if (!EMAIL_RE.test(email.value.trim())) {
    error.value = "Почта не похожа на email";
    return;
  }
  if (password.value.length < 6) {
    error.value = "Пароль должен быть не короче 6 символов";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    if (mode.value === "register") {
      await register(email.value.trim(), password.value);
    } else {
      await login(email.value.trim(), password.value);
    }
    emit("done");
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-form-wrap">
    <div class="auth-tabs">
      <button
        type="button"
        :class="['auth-tab', { on: mode === 'login' }]"
        @click="switchMode('login')"
      >Вход</button>
      <button
        type="button"
        :class="['auth-tab', { on: mode === 'register' }]"
        @click="switchMode('register')"
      >Регистрация</button>
    </div>

    <form class="auth-form" @submit.prevent="submit">
      <label class="field-label" for="auth-email">Почта</label>
      <input
        id="auth-email"
        class="field-input"
        type="email"
        v-model="email"
        placeholder="you@example.com"
        autocomplete="email"
        autofocus
      />

      <label class="field-label" for="auth-password">Пароль</label>
      <input
        id="auth-password"
        class="field-input"
        type="password"
        v-model="password"
        placeholder="Не короче 6 символов"
        autocomplete="current-password"
      />

      <div v-if="error" class="editor-error">{{ error }}</div>

      <p class="auth-note" v-if="mode === 'register'">
        Подтверждение почты не требуется. Списки и отметки будут храниться за вашей учётной записью.
      </p>

      <button class="btn-primary auth-submit" type="submit" :disabled="busy">
        {{ busy ? "Подождите…" : mode === "login" ? "Войти" : "Зарегистрироваться" }}
      </button>
    </form>
  </div>
</template>