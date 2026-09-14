export const SOURCE_COLORS = [
  "#f2f7ff",
  "#f2fbf4",
  "#fdf6ee",
  "#f7f2fd",
  "#fdf2f5",
  "#f0fafb"
];

export function sourceColor(index, len = SOURCE_COLORS.length) {
  return SOURCE_COLORS[index % len];
}