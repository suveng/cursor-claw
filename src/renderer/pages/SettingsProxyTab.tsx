interface Props {
  proxy: string
  noProxy: string
  inputCls: string
  onProxy: (v: string) => void
  onNoProxy: (v: string) => void
}

/** Settings 网络 Tab：HTTP 代理与 NO_PROXY */
export default function SettingsProxyTab({ proxy, noProxy, inputCls, onProxy, onNoProxy }: Props) {
  return (
    <>
      <section className="space-y-4">
        <h3 className="text-sm font-medium text-gray-300">代理设置</h3>
        <div>
          <label className="mb-1 block text-xs text-gray-500">HTTP / HTTPS 代理</label>
          <input type="text" value={proxy} onChange={(e) => onProxy(e.target.value)} placeholder="http://127.0.0.1:1080" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">NO_PROXY</label>
          <input type="text" value={noProxy} onChange={(e) => onNoProxy(e.target.value)} placeholder="localhost,127.0.0.1,feishu.cn" className={inputCls} />
        </div>
      </section>
    </>
  )
}
