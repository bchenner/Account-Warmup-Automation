import { useCallback, useEffect, useState } from 'react'
import type { Proxy, Verification } from '@shared/schemas'

export default function Proxies(): JSX.Element {
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const refresh = useCallback(async () => {
    const res = await window.boiler.listProxies()
    if (res.ok) setProxies(res.value)
    else setError(res.error)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const verify = async (id: string): Promise<void> => {
    setBusy((b) => new Set(b).add(id))
    setError(null)
    const res = await window.boiler.verifyProxy(id)
    if (!res.ok) setError(res.error)
    await refresh()
    setBusy((b) => {
      const next = new Set(b)
      next.delete(id)
      return next
    })
  }

  const remove = async (id: string): Promise<void> => {
    const res = await window.boiler.removeProxy(id)
    if (!res.ok) setError(res.error)
    await refresh()
  }

  // Expiry is when a vendor silently reassigns an IP, so it is sorted forward.
  const sorted = [...proxies].sort((a, b) => (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'))

  return (
    <div className="p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Proxies</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            One static ISP IP per profile, never shared. Every proxy is verified before it can be
            assigned — and re-verified on each renewal, because a check that runs once stops being
            true the moment an IP changes.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="shrink-0 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          {adding ? 'Cancel' : 'Add proxies'}
        </button>
      </header>

      {adding && (
        <AddForm
          onDone={async () => {
            setAdding(false)
            await refresh()
          }}
          onError={setError}
        />
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-verdict-fail/40 bg-verdict-fail/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {sorted.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => (
            <ProxyRow
              key={p.id}
              proxy={p}
              busy={busy.has(p.id)}
              onVerify={() => verify(p.id)}
              onRemove={() => remove(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Empty(): JSX.Element {
  return (
    <div className="rounded-2xl border border-dashed border-surface-border p-8 text-center">
      <p className="text-sm text-neutral-400">No proxies yet.</p>
      <p className="mx-auto mt-2 max-w-md text-xs text-neutral-500">
        Buy Proxy-Seller <span className="text-neutral-300">ISP</span> proxies — not Mobile, not
        Residential (rotating), not IPv4 datacenter — in the US, with IP-whitelist auth over
        HTTP(S). Then paste the <code className="text-neutral-300">host:port</code> list here.
      </p>
    </div>
  )
}

function AddForm({
  onDone,
  onError
}: {
  onDone: () => void
  onError: (e: string) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const [country, setCountry] = useState('US')
  const [expiresAt, setExpiresAt] = useState('')
  const [pending, setPending] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])

  const submit = async (): Promise<void> => {
    setPending(true)
    setSkipped([])
    const res = await window.boiler.addProxyBatch(text, {
      country: country.toUpperCase(),
      expiresAt: expiresAt || null
    })
    setPending(false)
    if (!res.ok) {
      onError(res.error)
      return
    }
    setSkipped(res.value.skipped)
    setText('')
    onDone()
  }

  return (
    <div className="mb-6 rounded-2xl border border-surface-border bg-surface-secondary p-4">
      <label className="mb-1 block text-xs font-medium text-neutral-300">
        Paste one <code>host:port</code> per line
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={'198.51.100.20:8000\n198.51.100.21:8000'}
        className="w-full rounded-lg border border-surface-border bg-surface-primary p-2 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-600"
      />
      <p className="mt-1 text-xxs text-neutral-500">
        Vendor lines with credentials appended are accepted, but the credentials are dropped —
        Chrome ignores proxy credentials entirely, so auth is by IP whitelist.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Country">
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={2}
            className="w-16 rounded-lg border border-surface-border bg-surface-primary px-2 py-1 text-sm uppercase text-neutral-200 outline-none focus:border-neutral-600"
          />
        </Field>
        <Field label="Rental expiry">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-surface-border bg-surface-primary px-2 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600"
          />
        </Field>
        <button
          onClick={submit}
          disabled={pending || !text.trim()}
          className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-40"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {skipped.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xxs text-verdict-warn">
          {skipped.map((s) => (
            <li key={s}>skipped {s}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-xxs uppercase tracking-wide text-neutral-500">{label}</div>
      {children}
    </div>
  )
}

function ProxyRow({
  proxy,
  busy,
  onVerify,
  onRemove
}: {
  proxy: Proxy
  busy: boolean
  onVerify: () => void
  onRemove: () => void
}): JSX.Element {
  const v = proxy.lastVerification
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-secondary p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-neutral-100">
              {proxy.host}:{proxy.port}
            </span>
            <StatusPill verification={v} />
            {proxy.assignedProfileId ? (
              <span className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-xxs text-neutral-400">
                → {proxy.assignedProfileId}
              </span>
            ) : (
              <span className="text-xxs text-neutral-500">unassigned</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xxs text-neutral-500">
            <span>{proxy.id}</span>
            <span>bought as {proxy.country}</span>
            {proxy.expiresAt && <span>expires {proxy.expiresAt}</span>}
            {v?.egressIp && <span className="text-neutral-400">egress {v.egressIp}</span>}
            {v?.asn && <span>{v.asn}</span>}
            {v?.org && <span className="truncate">{v.org}</span>}
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            onClick={onVerify}
            disabled={busy}
            className="rounded-lg border border-surface-border px-2.5 py-1 text-xs text-neutral-300 hover:bg-surface-tertiary disabled:opacity-40"
          >
            {busy ? 'Verifying…' : v ? 'Re-verify' : 'Verify'}
          </button>
          <button
            onClick={onRemove}
            className="rounded-lg border border-surface-border px-2.5 py-1 text-xs text-neutral-500 hover:bg-surface-tertiary hover:text-red-300"
          >
            Remove
          </button>
        </div>
      </div>

      {v && v.problems.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-surface-border pt-3">
          {v.problems.map((p) => (
            <li key={p} className="text-xs text-verdict-warn">
              {p}
            </li>
          ))}
        </ul>
      )}

      {v?.tls && (
        <div className="mt-2 font-mono text-xxs text-neutral-600">
          ja3 direct {v.tls.directJa3?.slice(0, 16) ?? '—'} · via proxy{' '}
          {v.tls.proxiedJa3?.slice(0, 16) ?? '—'}
        </div>
      )}
    </div>
  )
}

function StatusPill({ verification }: { verification: Verification | null }): JSX.Element {
  if (!verification) {
    return <Pill className="bg-verdict-unknown/20 text-neutral-400">unverified</Pill>
  }
  if (verification.ok) {
    return <Pill className="bg-verdict-pass/20 text-green-300">verified</Pill>
  }
  // A failed TLS comparison is categorically worse than a soft problem: it means
  // the proxy is decrypting traffic, so it can never be assigned.
  if (verification.tls?.matches === false) {
    return <Pill className="bg-verdict-fail/20 text-red-300">MITM — do not use</Pill>
  }
  return <Pill className="bg-verdict-warn/20 text-yellow-300">failed</Pill>
}

function Pill({ className, children }: { className: string; children: React.ReactNode }): JSX.Element {
  return <span className={`rounded-md px-1.5 py-0.5 text-xxs font-medium ${className}`}>{children}</span>
}
