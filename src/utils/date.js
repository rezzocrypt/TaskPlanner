export function startOfWeek(d) {
  const day = (d.getDay() + 6) % 7;
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dateKey(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function shortDate(d) {
  return pad2(d.getDate()) + "." + pad2(d.getMonth() + 1);
}

export function dayIndexFromKey(key) {
  const parts = key.split("-");
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  return (d.getDay() + 6) % 7;
}

export function dayIndexFromDate(d) {
  return (d.getDay() + 6) % 7;
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

export const DAY_NAMES = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье"
];