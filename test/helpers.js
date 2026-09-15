import http from "node:http";
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

export class ApiClient {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  req(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.base + path);
      const headers = {};
      const cs = [...this.cookies.entries()]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
      if (cs) headers.Cookie = cs;
      let raw = undefined;
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        raw = JSON.stringify(body);
      }
      const r = http.request(url, { method, headers }, (res) => {
        for (const c of res.headers["set-cookie"] || []) {
          const [pair] = c.split(";");
          const i = pair.indexOf("=");
          const name = pair.slice(0, i);
          const val = pair.slice(i + 1);
          if (val) this.cookies.set(name, val);
          else this.cookies.delete(name);
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          let json = null;
          try {
            if (data) json = JSON.parse(data);
          } catch (e) {}
          resolve({ status: res.statusCode, json, text: data, headers: res.headers });
        });
      });
      r.on("error", reject);
      if (raw !== undefined) r.write(raw);
      r.end();
    });
  }

  get(p) {
    return this.req("GET", p);
  }
  post(p, b) {
    return this.req("POST", p, b);
  }
  put(p, b) {
    return this.req("PUT", p, b);
  }
  del(p) {
    return this.req("DELETE", p);
  }
}

function randomPort() {
  return 10000 + Math.floor(Math.random() * 50000);
}

async function waitForReady(base, child) {
  const api = new ApiClient(base);
  const deadline = Date.now() + 20000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await api.post("/api/me");
      if (r.status === 200) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not start: " + (lastErr ? lastErr.message : "timeout"));
}

export async function startServer({ dbPath, seedPath } = {}) {
  const port = randomPort();
  const tmp =
    dbPath ||
    path.join(
      os.tmpdir(),
      "weekstreak-test-" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".db"
    );
  const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    env: { ...process.env, PORT: String(port), WEEKSTREAK_DB: tmp },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: ROOT
  });
  const base = "http://127.0.0.1:" + port;
  // drain output to avoid backpressure
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  await waitForReady(base, child);
  return { base, port, child, tmp };
}

export async function stopServer(server) {
  if (!server || !server.child) return;
  try {
    server.child.kill();
  } catch (e) {}
  await new Promise((r) => {
    server.child.once("exit", r);
    setTimeout(r, 2000);
  });
  const prefixes = [server.tmp, server.tmp + "-wal", server.tmp + "-shm"];
  for (const p of prefixes) {
    try {
      fs.rmSync(p, { force: true });
    } catch (e) {}
  }
}
