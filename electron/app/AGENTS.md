# app/ — 窗口、托盘、UI 日志、代理

## 模块边界

- `main-window.ts`：`BrowserWindow` 创建与 renderer 加载（dev `loadURL` / 打包 `loadFile`、`did-fail-load` fallback）；`main.ts` 仅注入退出状态并注册 IPC。
- `ui-logger.ts`：`pushUiLog` / `broadcastLog` / `getLogBuffer`；`SessionSource` 含 `"sdk"` / `"codex"` / `"opencode"` 等引擎标识。
- `proxy-env.ts`：子进程/Daemon 启动时的 HTTP(S) 代理 env 注入；**不** spawn Cursor CLI。
- `tray.ts`：系统托盘菜单与窗口显隐。

## 编码规矩

- 读配置走 `../config/config-store`；**禁止**在本目录直接读写 `electron-store`。
- 日志行格式与崩溃归档快照一致（UTF-8 单行）。
