/**
 * bind 后 SDK 预热：轻量 bootstrap + composer-2 limit 后台解析。
 * fire-and-forget，失败仅 WARN，不阻断 bind/launch。
 */
import { pushUiLog } from "../../app/ui-logger"
import { bootstrapSdkPluginWorkspace } from "../../mcp/loaders/plugin-sdk-bootstrap"
import { resolveModelContextLimit } from "./context-usage"

/** 预热用的默认模型 id（与首条 launch 常见 composer 路径对齐） */
const WARMUP_MODEL_ID = "composer-2"

export interface WarmupSdkAfterBindOptions {
  apiKey?: string
  workspaceDir?: string
  /** 日志来源：init / bind-electron / bind-daemon */
  source: string
}

/**
 * bind 成功后 fire-and-forget 预热 SDK 插件 workspace 与模型 limit cache。
 * 调用方须 void 调用，不 await；内部 async 链 catch 仅 WARN。
 */
export function warmupSdkAfterBind(opts: WarmupSdkAfterBindOptions): void {
  const apiKey = opts.apiKey?.trim()
  const workspaceDir = opts.workspaceDir?.trim()
  const source = opts.source?.trim() || "unknown"

  if (!apiKey || !workspaceDir) {
    pushUiLog(
      "SDK",
      "WARN",
      `[sdk_warmup] source=${source} 跳过：缺少 apiKey 或 workspaceDir`,
    )
    return
  }

  void (async () => {
    try {
      pushUiLog("SDK", "INFO", `[sdk_warmup] source=${source} 开始 cwd=${workspaceDir}`)
      // 非 detailed：不调用 logSdkPluginConfig，避免 ~5s 级配置日志
      bootstrapSdkPluginWorkspace(workspaceDir)
      // T1 启发式命中 composer-2 时同步写 cache，list 仅后台 refresh
      void resolveModelContextLimit(WARMUP_MODEL_ID, apiKey)
      pushUiLog("SDK", "INFO", `[sdk_warmup] source=${source} 完成`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      pushUiLog("SDK", "WARN", `[sdk_warmup] source=${source} 失败: ${msg}`)
    }
  })()
}
