import SettingsMcpEngineBlock from "./SettingsMcpEngineBlock"

interface Props {
  /** 主工作区路径（project 级 MCP 绑定） */
  workspaceDir: string
}

/** 过渡包装：固定 SDK 引擎；T5 将改由 SettingsEngineShell 直接挂载 EngineBlock */
export default function SettingsMcpPanel({ workspaceDir }: Props) {
  return <SettingsMcpEngineBlock engineType="sdk" workspaceDir={workspaceDir} />
}
