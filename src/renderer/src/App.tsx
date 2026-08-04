import { useState } from 'react'
import Proxies from './views/Proxies'
import Profiles from './views/Profiles'

type View = 'profiles' | 'proxies'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('profiles')

  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 border-r border-surface-border bg-surface-secondary p-3">
        <div className="px-2 pb-4 pt-1 text-sm font-semibold tracking-tight text-neutral-100">
          Boiler
        </div>
        <NavItem active={view === 'profiles'} onClick={() => setView('profiles')}>
          Profiles
        </NavItem>
        <NavItem active={view === 'proxies'} onClick={() => setView('proxies')}>
          Proxies
        </NavItem>
      </nav>

      <main className="flex-1 overflow-auto">{view === 'profiles' ? <Profiles /> : <Proxies />}</main>
    </div>
  )
}

function NavItem({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`mb-1 w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        active
          ? 'bg-surface-tertiary text-neutral-100'
          : 'text-neutral-400 hover:bg-surface-tertiary/50 hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}
