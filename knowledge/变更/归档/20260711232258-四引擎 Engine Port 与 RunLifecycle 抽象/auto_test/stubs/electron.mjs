/** 契约探针：替代 electron，避免 Node 直跑时 CJS/ESM 不兼容 */
export class BrowserWindow {
  static getAllWindows() {
    return []
  }
}

export const app = {
  getPath: () => process.env.KB_CONTRACT_USER_DATA ?? "/tmp/cursor-claw-contract-test",
}
