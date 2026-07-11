/**
 * HTTP 监听壳：MCP 接入、委托 `/api/*` 与非 API 路由（从 daemon.ts 抽出）。
 */
import * as http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, createAdminMcpServer } from "./daemon-http-mcp.js";
import { handleNonApiRoute, type NonApiRoutesDeps } from "./daemon-http-non-api-routes.js";

export interface HttpServerDeps extends NonApiRoutesDeps {
  configuredPort: number;
  handleAdminApi: (pathname: string, method: string, req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean>;
  activeMcpConnections: number;
  lastMcpRequestTime: number;
}

/** 启动 HTTP 服务；返回实际监听端口（EADDRINUSE 时回退随机端口） */
export function startHttpServer(deps: HttpServerDeps): Promise<number> {
  let daemonPort = 0;

  function json(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  function httpJson<T = unknown>(url: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const isPost = body !== undefined;
      const payload = isPost ? JSON.stringify(body) : undefined;
      const parsed = new URL(url);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: isPost ? "POST" : "GET",
        headers: isPost ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload!) } : undefined,
        timeout: timeoutMs,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch { reject(new Error(`daemon JSON parse: ${Buffer.concat(chunks).toString().slice(0, 200)}`)); }
        });
      });
      req.on("error", (e) => reject(new Error(`daemon request failed: ${e.message}`)));
      req.on("timeout", () => { req.destroy(); reject(new Error("daemon request timeout")); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  const localDaemonUrl = (p: string): string => `http://127.0.0.1:${daemonPort}${p}`;

  const mcpDeps = {
    log: deps.log,
    pkgVersion: deps.pkgVersion,
    httpJson,
    localDaemonUrl,
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
      const pathname = reqUrl.pathname;
      const method = req.method;

      try {
        if (pathname === "/mcp" || pathname === "/mcp-admin") {
          const isAgent = pathname === "/mcp";
          const srv = isAgent ? createMcpServer(mcpDeps) : createAdminMcpServer(mcpDeps);
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          if (isAgent) { deps.activeMcpConnections++; deps.lastMcpRequestTime = Date.now(); }
          res.on("close", () => {
            transport.close(); srv.close();
            if (isAgent) deps.activeMcpConnections = Math.max(0, deps.activeMcpConnections - 1);
          });
          await srv.connect(transport);
          await transport.handleRequest(req, res);
          return;
        }

        if (await deps.handleAdminApi(pathname, method!, req, res)) return;

        if (await handleNonApiRoute(deps, pathname, method, req, res)) return;

        json(res, { error: "not found" }, 404);
      } catch (e: unknown) {
        deps.log("ERROR", `HTTP 错误: ${pathname} ${e instanceof Error ? e.message : e}`);
        json(res, { error: e instanceof Error ? e.message : "internal error" }, 500);
      }
    });

    server.requestTimeout = 300_000;

    const tryListen = (port: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (port > 0 && err.code === "EADDRINUSE") {
          deps.log("WARN", `端口 ${port} 被占用，回退到随机端口`);
          server.removeAllListeners("error");
          tryListen(0);
          return;
        }
        deps.log("ERROR", `HTTP Server 错误: ${err.message}`);
        reject(err);
      });
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        daemonPort = addr.port;
        deps.log("INFO", `HTTP Server 监听: http://127.0.0.1:${addr.port}`);
        resolve(addr.port);
      });
    };
    tryListen(deps.configuredPort);
  });
}
