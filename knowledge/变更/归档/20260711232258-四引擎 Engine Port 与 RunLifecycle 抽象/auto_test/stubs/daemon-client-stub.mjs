/** 契约探针：替代 daemon-client，捕获 POST /api/send-text 载荷 */
export const sendTextCalls = []

export function resetSendTextCapture() {
  sendTextCalls.length = 0
}

export function readLockFile() {
  return { port: 19528, pid: 1, version: "contract" }
}

export async function httpPost(url, body) {
  sendTextCalls.push({ url, body })
  return { ok: true }
}

export function getLockFilePath() {
  return "/tmp/cursor-claw-contract.lock"
}

export async function httpGet() {
  return {}
}
