#!/usr/bin/env node
import { daemonMain } from "./daemon/daemon.js";

daemonMain().catch((e) => {
  try {
    process.stderr.write(`[Daemon] 启动失败: ${e}\n`);
  } catch {
    /* 断管等写 stderr 失败时静默 */
  }
  process.exit(1);
});
