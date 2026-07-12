/**
 * Daemon HTTP 小工具：readBody / json / httpJson（供 hub 与子模块注入）。
 */
import * as http from "node:http";

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    req.on("end", () => resolve(chunks.join("")));
    req.on("error", reject);
  });
}

export function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** 出向 JSON HTTP（Electron agent-api / 本机 daemon） */
export function httpJson<T = unknown>(url: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const isPost = body !== undefined;
    const payload = isPost ? JSON.stringify(body) : undefined;
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: isPost ? "POST" : "GET",
      headers: isPost
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload!) }
        : undefined,
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          reject(new Error(`daemon JSON parse: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
        }
      });
    });
    req.on("error", (e) => reject(new Error(`daemon request failed: ${e.message}`)));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("daemon request timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export function makeLocalDaemonUrl(getPort: () => number): (p: string) => string {
  return (p: string) => `http://127.0.0.1:${getPort()}${p}`;
}
