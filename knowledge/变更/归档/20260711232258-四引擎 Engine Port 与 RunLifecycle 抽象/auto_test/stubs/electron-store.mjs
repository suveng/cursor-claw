/** 契约探针：替代 electron-store */
export default class Store {
  constructor(_opts) {}
  get(_key, defaultValue) {
    return defaultValue
  }
  set(_key, _value) {}
}
