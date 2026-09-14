export function taskText(t) {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return String(t.text != null ? t.text : "");
  return String(t);
}

export function taskTime(t) {
  if (!t || typeof t !== "object") return "";
  const s = t.start || "";
  const e = t.end || "";
  if (s && e) return s + "–" + e;
  return s || e;
}

export function taskStart(t) {
  if (!t || typeof t !== "object" || !t.start) return null;
  return String(t.start);
}

export function startMinutes(t) {
  const start = taskStart(t);
  if (start === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(start.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function taskDays(t) {
  if (!t || typeof t !== "object") return null;
  return Array.isArray(t.days) ? t.days : null;
}

export function taskOnDay(t, dayIndex) {
  const days = taskDays(t);
  if (!days) return true;
  return days.includes(dayIndex);
}

export function isStringTask(t) {
  return typeof t === "string";
}