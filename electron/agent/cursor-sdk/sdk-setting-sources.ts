/**
 * Cursor SDK ambient 配置层 SSOT：与 Cursor IDE 对齐，含插件市场/第三方插件层。
 * 官方优先级：inline > plugins > project > user
 */
export const SDK_SETTING_SOURCES = ["project", "user", "plugins"] as const

/** [config] 日志用逗号分隔标签 */
export function formatSdkSettingSourcesLabel(): string {
  return SDK_SETTING_SOURCES.join(",")
}
