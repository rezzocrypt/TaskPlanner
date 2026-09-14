const COOKIE = "weekplan-uid";
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomId(len) {
  const arr = new Uint32Array(len);
  const c = window.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(arr);
  } else {
    for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 0xffffffff);
  }
  let out = "";
  for (let i = 0; i < len; i++) out += CHARS[arr[i] % CHARS.length];
  return out;
}

export function getUid() {
  const m = new RegExp("(?:^|;\\s*)(" + COOKIE + ")=([^;]+)").exec(document.cookie);
  if (m && m[2]) return m[2];
  const uid = randomId(20);
  document.cookie = COOKIE + "=" + uid + "; path=/; max-age=31536000; SameSite=Lax";
  return uid;
}

export function randomToken(len = 12) {
  const arr = new Uint32Array(len);
  const c = window.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(arr);
  } else {
    for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 0xffffffff);
  }
  let out = "";
  for (let i = 0; i < len; i++) out += CHARS[arr[i] % CHARS.length];
  return out;
}