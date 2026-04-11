import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

const STORAGE_KEY = 'glassbox_eval_running'

interface StoredState {
  model: string
  startedAt: number
}

// Auto-expire after 30 minutes in case the tab was closed mid-run
const EXPIRY_MS = 30 * 60 * 1000

function readStorage(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: StoredState = JSON.parse(raw)
    if (Date.now() - parsed.startedAt > EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed.model
  } catch {
    return null
  }
}

interface EvalRunContextValue {
  isEvalRunning: boolean
  evalModel: string | null
  startEval: (model: string) => void
  stopEval: () => void
}

const EvalRunContext = createContext<EvalRunContextValue>({
  isEvalRunning: false,
  evalModel: null,
  startEval: () => {},
  stopEval: () => {},
})

export function EvalRunProvider({ children }: { children: ReactNode }) {
  const [evalModel, setEvalModel] = useState<string | null>(() => readStorage())

  const startEval = (model: string) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ model, startedAt: Date.now() }))
    setEvalModel(model)
  }

  const stopEval = () => {
    localStorage.removeItem(STORAGE_KEY)
    setEvalModel(null)
  }

  // Sync across tabs
  useEffect(() => {
    const handler = () => setEvalModel(readStorage())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  return (
    <EvalRunContext.Provider value={{ isEvalRunning: evalModel !== null, evalModel, startEval, stopEval }}>
      {children}
    </EvalRunContext.Provider>
  )
}

export function useEvalRun() {
  return useContext(EvalRunContext)
}
