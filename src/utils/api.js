export async function api(path, options = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    if (res.ok) return null;
  }
  if (!res.ok) {
    throw new Error((data && data.error) || "HTTP " + res.status);
  }
  return data;
}