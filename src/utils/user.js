import { api } from "./api";

let uidCache = null;

export async function getUid() {
  if (uidCache) return uidCache;
  const data = await api("/me", { method: "POST" });
  uidCache = data.uid;
  document.cookie =
    "weekplan-uid=" +
    encodeURIComponent(data.uid) +
    "; path=/; max-age=31536000; SameSite=Lax";
  return data.uid;
}