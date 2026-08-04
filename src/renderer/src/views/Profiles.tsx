import { useCallback, useEffect, useState } from 'react'
import type { CreateProfileInput } from '@shared/ipc'
import type { Profile, ProfileRow, Proxy } from '@shared/schemas'

export default function Profiles(): JSX.Element {
  const [rows, setRows] = useState<ProfileRow[]>([])
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [chrome, setChrome] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [p, px, c] = await Promise.all([
      window.boiler.listProfiles(),
      window.boiler.listProxies(),
      window.boiler.chromePath()
    ])
    if (p.ok) setRows(p.value)
    else setError(p.error)
    if (px.ok) setProxies(px.value)
    if (c.ok) setChrome(c.value)
  }, [])

  useEffect(() => {
    void refresh()
    // Chrome exiting is not something the renderer can observe directly, so the
    // running column is polled rather than pushed.
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [refresh])

  const launch = async (row: ProfileRow): Promise<void> => {
    setBusy(row.id)
    setError(null)
    setNotice(null)
    const res = await window.boiler.launchProfile(row.id)
    if (!res.ok) setError(res.error)
    else if (res.value.direct) {
      setNotice(`${row.name} opened on your REAL IP — no proxy assigned.`)
    } else {
      setNotice(`${row.name} opened on ${res.value.egressIp}.`)
    }
    await refresh()
    setBusy(null)
  }

  const stop = async (row: ProfileRow): Promise<void> => {
    const res = await window.boiler.stopProfile(row.id)
    if (!res.ok) setError(res.error)
    await refresh()
  }

  // Two-step inline rather than window.confirm: Electron's is a native blocking
  // dialog, which is both unstyled and impossible to drive from a test.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const remove = async (row: ProfileRow): Promise<void> => {
    if (confirming !== row.id) {
      setConfirming(row.id)
      return
    }
    setConfirming(null)
    const res = await window.boiler.deleteProfile(row.personaSlug, row.id)
    if (!res.ok) setError(res.error)
    await refresh()
  }

  const unassigned = proxies.filter((p) => !p.assignedProfileId && p.lastVerification?.ok)

  return (
    <div className="p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Profiles</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            One browser profile per identity, each pinned to its own IP. Opening a profile checks
            the proxy first and refuses to launch if the IP has changed — it never falls back to
            your real connection.
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="shrink-0 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          {creating ? 'Cancel' : 'New profile'}
        </button>
      </header>

      {!chrome && (
        <Banner tone="fail">
          Google Chrome was not found on this machine. Profiles cannot be opened until it is
          installed.
        </Banner>
      )}
      {error && <Banner tone="fail">{error}</Banner>}
      {notice && <Banner tone="pass">{notice}</Banner>}

      {creating && (
        <CreateForm
          proxies={unassigned}
          onError={setError}
          onDone={async () => {
            setCreating(false)
            await refresh()
          }}
        />
      )}

      {rows.length === 0 ? (
        <Empty hasProxies={proxies.length > 0} />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              busy={busy === row.id}
              confirmingDelete={confirming === row.id}
              editing={editing === row.id}
              proxies={proxies}
              onEdit={() => setEditing(editing === row.id ? null : row.id)}
              onSaved={async () => {
                setEditing(null)
                await refresh()
              }}
              onError={setError}
              onLaunch={() => launch(row)}
              onStop={() => stop(row)}
              onDelete={() => remove(row)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Banner({ tone, children }: { tone: 'pass' | 'fail'; children: React.ReactNode }): JSX.Element {
  const cls =
    tone === 'pass'
      ? 'border-verdict-pass/40 bg-verdict-pass/10 text-green-300'
      : 'border-verdict-fail/40 bg-verdict-fail/10 text-red-300'
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>
}

function Empty({ hasProxies }: { hasProxies: boolean }): JSX.Element {
  return (
    <div className="rounded-2xl border border-dashed border-surface-border p-8 text-center">
      <p className="text-sm text-neutral-400">No profiles yet.</p>
      <p className="mx-auto mt-2 max-w-md text-xs text-neutral-500">
        {hasProxies
          ? 'Create a profile and bind it to a verified proxy. Register the social account inside that profile — one device and one IP from the very first minute.'
          : 'Add and verify a proxy first, then create a profile bound to it.'}
      </p>
    </div>
  )
}

function Row({
  row,
  busy,
  confirmingDelete,
  editing,
  proxies,
  onEdit,
  onSaved,
  onError,
  onLaunch,
  onStop,
  onDelete
}: {
  row: ProfileRow
  busy: boolean
  confirmingDelete: boolean
  editing: boolean
  proxies: Proxy[]
  onEdit: () => void
  onSaved: () => void
  onError: (e: string) => void
  onLaunch: () => void
  onStop: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div
      data-profile-id={row.id}
      className="rounded-2xl border border-surface-border bg-surface-secondary p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-neutral-100">{row.name}</span>
            {row.running && (
              <span className="flex items-center gap-1 rounded-md bg-verdict-pass/20 px-1.5 py-0.5 text-xxs font-medium text-green-300">
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> open
              </span>
            )}
            <ProxyPill row={row} />
          </div>

          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xxs text-neutral-500">
            <span>{row.personaName}</span>
            <span>{row.id}</span>
            <span>
              {row.fingerprint.windowWidth}×{row.fingerprint.windowHeight}
            </span>
            <span>{row.fingerprint.timezone}</span>
            <span>{row.fingerprint.locale}</span>
            <span>
              {row.lastUsedAt ? `last opened ${new Date(row.lastUsedAt).toLocaleString()}` : 'never opened'}
            </span>
          </div>

          {row.accounts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.accounts.map((a) => (
                <span
                  key={a.platform}
                  className="rounded-md bg-surface-tertiary px-1.5 py-0.5 text-xxs text-neutral-300"
                >
                  {a.platform}
                  {a.username ? ` · ${a.username}` : ' · unregistered'}
                  {a.health !== 'ok' && <span className="ml-1 text-verdict-warn">{a.health}</span>}
                </span>
              ))}
            </div>
          )}

          {row.notes && <p className="mt-2 max-w-2xl text-xs text-neutral-500">{row.notes}</p>}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            onClick={onEdit}
            className="rounded-lg border border-surface-border px-2.5 py-1 text-xs text-neutral-300 hover:bg-surface-tertiary"
          >
            {editing ? 'Done' : 'Edit'}
          </button>
          {row.running ? (
            <button
              onClick={onStop}
              className="rounded-lg border border-surface-border px-2.5 py-1 text-xs text-neutral-300 hover:bg-surface-tertiary"
            >
              Close
            </button>
          ) : (
            <button
              onClick={onLaunch}
              disabled={busy}
              className="rounded-lg bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
            >
              {busy ? 'Opening…' : 'Open'}
            </button>
          )}
          <button
            onClick={onDelete}
            title={
              confirmingDelete
                ? 'Destroys the browser profile directory — cookies, logins and the accumulated browser identity. Logging in again does NOT restore it.'
                : undefined
            }
            className={`rounded-lg border px-2.5 py-1 text-xs ${
              confirmingDelete
                ? 'border-verdict-fail/50 bg-verdict-fail/15 text-red-300'
                : 'border-surface-border text-neutral-500 hover:bg-surface-tertiary hover:text-red-300'
            }`}
          >
            {confirmingDelete ? 'Confirm delete' : 'Delete'}
          </button>
        </div>
      </div>

      {confirmingDelete && (
        <p className="mt-3 border-t border-surface-border pt-3 text-xs text-red-300">
          This destroys the browser profile directory — cookies, logins, and the accumulated
          browser identity that makes the account look established. Logging in again does not
          restore it. Click again to confirm.
        </p>
      )}

      {editing && (
        <EditForm row={row} proxies={proxies} onSaved={onSaved} onError={onError} />
      )}
    </div>
  )
}

function EditForm({
  row,
  proxies,
  onSaved,
  onError
}: {
  row: ProfileRow
  proxies: Proxy[]
  onSaved: () => void
  onError: (e: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState<Profile>(row)
  const [pending, setPending] = useState(false)

  const set = <K extends keyof Profile>(k: K, v: Profile[K]): void =>
    setDraft((d) => ({ ...d, [k]: v }))
  const setFp = <K extends keyof Profile['fingerprint']>(
    k: K,
    v: Profile['fingerprint'][K]
  ): void => setDraft((d) => ({ ...d, fingerprint: { ...d.fingerprint, [k]: v } }))

  // Its own proxy stays selectable; others must be free and verified.
  const selectable = proxies.filter(
    (p) => p.id === row.proxyId || (!p.assignedProfileId && p.lastVerification?.ok)
  )

  const save = async (): Promise<void> => {
    setPending(true)
    const res = await window.boiler.updateProfile(draft)
    setPending(false)
    if (!res.ok) return onError(res.error)
    onSaved()
  }

  return (
    <div className="mt-3 space-y-3 border-t border-surface-border pt-3">
      {row.running && (
        <p className="text-xxs text-verdict-warn">
          This profile is open. Fingerprint and proxy changes are applied at launch, so they take
          effect the next time you open it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Profile name">
          <Input value={draft.name} onChange={(v) => set('name', v)} />
        </Field>
        <Field label="Proxy">
          <select
            value={draft.proxyId ?? ''}
            onChange={(e) => set('proxyId', e.target.value || null)}
            className="w-full rounded-lg border border-surface-border bg-surface-primary px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600"
          >
            <option value="">— none —</option>
            {selectable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.host}:{p.port} · {p.lastVerification?.country ?? p.country}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Timezone">
          <Input value={draft.fingerprint.timezone} onChange={(v) => setFp('timezone', v)} />
        </Field>
        <Field label="Locale">
          <Input value={draft.fingerprint.locale} onChange={(v) => setFp('locale', v)} />
        </Field>
        <Field label="Window width">
          <Input
            value={String(draft.fingerprint.windowWidth)}
            onChange={(v) => setFp('windowWidth', Number(v) || 0)}
          />
        </Field>
        <Field label="Window height">
          <Input
            value={String(draft.fingerprint.windowHeight)}
            onChange={(v) => setFp('windowHeight', Number(v) || 0)}
          />
        </Field>
      </div>

      <Field label="Notes">
        <Input value={draft.notes} onChange={(v) => set('notes', v)} placeholder="notes" />
      </Field>

      {!draft.proxyId && (
        <label className="flex items-start gap-2 rounded-lg border border-verdict-fail/40 bg-verdict-fail/10 p-2">
          <input
            type="checkbox"
            checked={draft.allowDirect}
            onChange={(e) => set('allowDirect', e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xxs text-red-300">
            Allow opening on my real IP. With no proxy every site sees your home connection.
          </span>
        </label>
      )}

      <button
        onClick={save}
        disabled={pending || !draft.name.trim()}
        className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

function ProxyPill({ row }: { row: ProfileRow }): JSX.Element {
  if (!row.proxyLabel) {
    return row.allowDirect ? (
      <span className="rounded-md bg-verdict-fail/20 px-1.5 py-0.5 font-mono text-xxs text-red-300">
        DIRECT — real IP
      </span>
    ) : (
      <span className="rounded-md bg-verdict-unknown/20 px-1.5 py-0.5 text-xxs text-neutral-400">
        no proxy
      </span>
    )
  }
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 font-mono text-xxs ${
        row.proxyVerified ? 'bg-verdict-pass/20 text-green-300' : 'bg-verdict-warn/20 text-yellow-300'
      }`}
    >
      {row.proxyLabel}
      {!row.proxyVerified && ' · unverified'}
    </span>
  )
}

const DEFAULTS: CreateProfileInput = {
  personaName: '',
  name: '',
  niche: '',
  country: 'US',
  proxyId: null,
  allowDirect: false,
  notes: '',
  timezone: 'America/New_York',
  locale: 'en-US',
  windowWidth: 1512,
  windowHeight: 982
}

function CreateForm({
  proxies,
  onDone,
  onError
}: {
  proxies: Proxy[]
  onDone: () => void
  onError: (e: string) => void
}): JSX.Element {
  const [form, setForm] = useState<CreateProfileInput>(DEFAULTS)
  const [pending, setPending] = useState(false)
  const set = <K extends keyof CreateProfileInput>(k: K, v: CreateProfileInput[K]): void =>
    setForm((f) => ({ ...f, [k]: v }))

  const submit = async (): Promise<void> => {
    setPending(true)
    const res = await window.boiler.createProfile(form)
    setPending(false)
    if (!res.ok) {
      onError(res.error)
      return
    }
    setForm(DEFAULTS)
    onDone()
  }

  return (
    <div className="mb-6 space-y-4 rounded-2xl border border-surface-border bg-surface-secondary p-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Profile name">
          <Input value={form.name} onChange={(v) => set('name', v)} placeholder="Maya · Instagram" />
        </Field>
        <Field label="Persona" hint="grouping; reused across this persona's profiles">
          <Input value={form.personaName} onChange={(v) => set('personaName', v)} placeholder="Maya" />
        </Field>
        <Field label="Niche" hint="drives follow-target search during warmup">
          <Input value={form.niche} onChange={(v) => set('niche', v)} placeholder="home fitness" />
        </Field>
        <Field label="Country" hint="drives timezone, locale and geolocation">
          <Input value={form.country} onChange={(v) => set('country', v.toUpperCase())} />
        </Field>
      </div>

      <div>
        <div className="mb-1 text-xxs uppercase tracking-wide text-neutral-500">Proxy</div>
        <select
          value={form.proxyId ?? ''}
          onChange={(e) => set('proxyId', e.target.value || null)}
          className="w-full rounded-lg border border-surface-border bg-surface-primary px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600"
        >
          <option value="">— none —</option>
          {proxies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.host}:{p.port} · {p.lastVerification?.country ?? p.country}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xxs text-neutral-500">
          Only verified, unassigned proxies are listed — one IP belongs to exactly one profile.
        </p>

        {!form.proxyId && (
          <label className="mt-2 flex items-start gap-2 rounded-lg border border-verdict-fail/40 bg-verdict-fail/10 p-2">
            <input
              type="checkbox"
              checked={form.allowDirect}
              onChange={(e) => set('allowDirect', e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xxs text-red-300">
              Open this profile on my real IP. Without a proxy every site sees your home
              connection — fine for trying the app out, not for a social account you care about.
            </span>
          </label>
        )}
      </div>

      <details className="rounded-lg border border-surface-border bg-surface-primary p-3">
        <summary className="cursor-pointer text-xs text-neutral-300">Fingerprint</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Timezone">
            <Input value={form.timezone} onChange={(v) => set('timezone', v)} />
          </Field>
          <Field label="Locale">
            <Input value={form.locale} onChange={(v) => set('locale', v)} />
          </Field>
          <Field label="Window width">
            <Input value={String(form.windowWidth)} onChange={(v) => set('windowWidth', Number(v) || 0)} />
          </Field>
          <Field label="Window height">
            <Input
              value={String(form.windowHeight)}
              onChange={(v) => set('windowHeight', Number(v) || 0)}
            />
          </Field>
        </div>
        <p className="mt-3 text-xxs text-neutral-500">
          These four are set at launch — as Chrome flags and a process env var — so they stay
          consistent all the way down to the request headers. Everything else (GPU, canvas, fonts,
          user agent) is deliberately left as this machine&apos;s real values: a partial spoof is
          more identifiable than none, and faking those requires injecting code into the page,
          which is itself detectable.
        </p>
      </details>

      <Field label="Notes">
        <Input value={form.notes} onChange={(v) => set('notes', v)} placeholder="optional" />
      </Field>

      <button
        onClick={submit}
        disabled={pending || !form.name.trim() || !form.personaName.trim() || !form.niche.trim()}
        className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-40"
      >
        {pending ? 'Creating…' : 'Create profile'}
      </button>
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 text-xxs uppercase tracking-wide text-neutral-500">{label}</div>
      {children}
      {hint && <p className="mt-1 text-xxs text-neutral-600">{hint}</p>}
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="w-full rounded-lg border border-surface-border bg-surface-primary px-2 py-1.5 text-sm text-neutral-200 outline-none placeholder:text-neutral-700 focus:border-neutral-600"
    />
  )
}
