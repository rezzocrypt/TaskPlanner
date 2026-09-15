import { ref } from "vue";
import { getMe, register as apiRegister, login as apiLogin, logout as apiLogout } from "../utils/user";

const user = ref(null);

export function useAuth() {
  async function load() {
    if (!user.value) {
      const me = await getMe();
      user.value = { uid: me.uid, email: me.email };
    }
    return user.value;
  }

  async function register(email, password) {
    const me = await apiRegister(email, password);
    user.value = { uid: me.uid, email: me.email };
    return user.value;
  }

  async function login(email, password) {
    const me = await apiLogin(email, password);
    user.value = { uid: me.uid, email: me.email };
    return user.value;
  }

  async function logout() {
    await apiLogout();
    user.value = null;
  }

  return { user, load, register, login, logout };
}