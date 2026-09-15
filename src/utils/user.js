import { api } from "./api";

let meCache = null;

function setMe(data) {
  meCache = data ? { uid: data.uid, email: data.email || null } : null;
}

export async function getMe() {
  if (!meCache) {
    setMe(await api("/me", { method: "POST" }));
  }
  return meCache;
}

export async function getUid() {
  return (await getMe()).uid;
}

export async function register(email, password) {
  setMe(await api("/register", { method: "POST", body: { email, password } }));
  return meCache;
}

export async function login(email, password) {
  setMe(await api("/login", { method: "POST", body: { email, password } }));
  return meCache;
}

export async function logout() {
  await api("/logout", { method: "POST" });
  setMe(null);
}