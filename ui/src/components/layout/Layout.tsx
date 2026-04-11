import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Home,
  MessageSquare,
  FlaskConical,
  TrendingUp,
  Scale,
  Activity,
  ShieldCheck,
  ScrollText,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/lib/ThemeToggle'
import { useEvalRun } from '@/lib/evalRunContext'

const nav = [
  { to: '/',           icon: Home,          label: 'Home' },
  { to: '/spec',       icon: ShieldCheck,   label: 'Behavioral Spec' },
  { to: '/runtime',    icon: MessageSquare, label: 'Live Runtime' },
  { to: '/test-suite', icon: FlaskConical,  label: 'Model Evaluation' },
  { to: '/drift',      icon: TrendingUp,    label: 'Baseline & Drift' },
  { to: '/compare',    icon: Scale,         label: 'Model Comparison' },
  { to: '/monitor',    icon: Activity,      label: 'Production Monitor' },
  { to: '/chatlogs',   icon: ScrollText,    label: 'Chat Log Analytics' },
]

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isHome = location.pathname === '/'
  const { isEvalRunning, evalModel } = useEvalRun()

  if (isHome) {
    return <Outlet />
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border flex flex-col">
        {/* Logo row */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-border">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span className="font-bold tracking-tight text-foreground">Glass Box</span>
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider text-white"
              style={{ backgroundColor: '#0D9488' }}
            >
              BETA
            </span>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-2 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => {
            const isEvalNav = to === '/test-suite'
            const showRunning = isEvalNav && isEvalRunning
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                {showRunning
                  ? <Loader2 className="size-4 shrink-0 animate-spin" style={{ color: '#0D9488' }} />
                  : <Icon className="size-4 shrink-0" />
                }
                <span className="flex-1">{label}</span>
                {showRunning && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider text-white animate-pulse" style={{ backgroundColor: '#0D9488' }}>
                    Running
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Theme toggle */}
        <div className="p-3 border-t border-border">
          <ThemeToggle variant="pill" className="w-full justify-center" />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
