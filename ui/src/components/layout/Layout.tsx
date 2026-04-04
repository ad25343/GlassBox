import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  Home,
  MessageSquare,
  FlaskConical,
  TrendingUp,
  Scale,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/lib/ThemeToggle'

const nav = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/runtime', icon: MessageSquare, label: 'Live Runtime' },
  { to: '/test-suite', icon: FlaskConical, label: 'Test Suite' },
  { to: '/drift', icon: TrendingUp, label: 'Baseline & Drift' },
  { to: '/compare', icon: Scale, label: 'Model Comparison' },
  { to: '/monitor', icon: Activity, label: 'Production Monitor' },
]

export default function Layout() {
  const location = useLocation()
  const isHome = location.pathname === '/'

  if (isHome) {
    return <Outlet />
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border flex flex-col">
        {/* Logo row */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-tight text-foreground">Glass Box</span>
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider text-white"
              style={{ backgroundColor: '#0D9488' }}
            >
              BETA
            </span>
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-2 space-y-0.5">
          {nav.map(({ to, icon: Icon, label }) => (
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
              <Icon className="size-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Theme toggle — bottom of sidebar, full width pill */}
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
