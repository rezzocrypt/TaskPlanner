import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

function saveJsonPlugin() {
  return {
    name: "save-json",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method === "POST" && req.url === "/__save") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const { file, content } = JSON.parse(body || "{}");
              if (!file || typeof content !== "string") {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "file и content обязательны" }));
                return;
              }
              const rel = resolveJsonFile(file);
              if (!rel) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Недопустимый путь файла" }));
                return;
              }
              JSON.parse(content);
              const target = path.join(PUBLIC_DIR, rel);
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.writeFileSync(target, content, "utf8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, file: rel }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e && e.message || e) }));
            }
          });
          return;
        }

        if (req.method === "POST" && req.url === "/__delete") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const { file } = JSON.parse(body || "{}");
              if (!file) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "file обязателен" }));
                return;
              }
              const rel = resolveJsonFile(file);
              if (!rel) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Недопустимый путь файла" }));
                return;
              }
              if (rel === "manifest.json") {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: "Корневой manifest.json удалять нельзя" }));
                return;
              }
              const target = path.join(PUBLIC_DIR, rel);
              if (fs.existsSync(target)) fs.unlinkSync(target);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, file: rel }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e && e.message || e) }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

function resolveJsonFile(file) {
  const decoded = decodeURIComponent(String(file)).replace(/\\/g, "/");
  const rel = decoded.replace(/^\/+/, "");
  if (!rel.toLowerCase().endsWith(".json")) return null;
  const target = path.resolve(PUBLIC_DIR, rel);
  const root = path.resolve(PUBLIC_DIR);
  if (target === root || !target.startsWith(root + path.sep)) return null;
  return path.relative(root, target).replace(/\\/g, "/");
}

export default defineConfig({
  plugins: [vue(), saveJsonPlugin()]
});