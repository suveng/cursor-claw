/** 子进程 / HTTP 客户端共用的代理环境变量注入（从 agent-cli 抽出，供 Daemon 与 SDK/CC 复用） */

const PROXY_ENV_KEYS = [
  "HTTP_PROXY", "http_proxy",
  "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy",
  "NO_PROXY", "no_proxy",
] as const

/** 按应用配置覆盖 env 中的代理相关变量；先清除旧值再写入，避免继承脏环境 */
export function applyProxyEnv(
  env: Record<string, string>,
  config: { httpProxy?: string; httpsProxy?: string; noProxy?: string },
): void {
  for (const key of PROXY_ENV_KEYS) delete env[key]
  if (config.httpProxy) {
    env.HTTP_PROXY = config.httpProxy
    env.http_proxy = config.httpProxy
  }
  if (config.httpsProxy) {
    env.HTTPS_PROXY = config.httpsProxy
    env.https_proxy = config.httpsProxy
    env.ALL_PROXY = config.httpsProxy
    env.all_proxy = config.httpsProxy
  }
  if (config.noProxy) {
    env.NO_PROXY = config.noProxy
    env.no_proxy = config.noProxy
  }
}
