import { Sun, Moon } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

type Theme = 'light' | 'dark'
const CYCLE: Theme[] = ['light', 'dark']

const CONFIG: Record<Theme, { Icon: typeof Sun; label: string }> = {
  light:  { Icon: Sun,  label: 'Light' },
  dark:   { Icon: Moon, label: 'Dark'  },
}

interface ThemeToggleProps {
  /** 'icon' = icon only (sidebar), 'pill' = icon + label (home page / topbar) */
  variant?: 'icon' | 'pill'
  className?: string
}

export function ThemeToggle({ variant = 'icon', className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme()

  function cycleTheme() {
    const idx = CYCLE.indexOf(theme)
    setTheme(CYCLE[(idx + 1) % CYCLE.length])
  }

  const { Icon, label } = CONFIG[theme]

  if (variant === 'pill') {
    return (
      <button
        onClick={cycleTheme}
        aria-label={`Theme: ${label}. Click to switch.`}
        className={cn(
          'flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5',
          'text-sm text-muted-foreground hover:text-foreground hover:bg-accent',
          'transition-colors',
          className,
        )}
      >
        <Icon className="size-3.5" />
        <span>{label}</span>
      </button>
    )
  }

  return (
    <button
      onClick={cycleTheme}
      aria-label={`Theme: ${label}. Click to switch.`}
      className={cn(
        'p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}
