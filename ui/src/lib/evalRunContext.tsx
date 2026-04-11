import { createContext, useContext, useState, type ReactNode } from 'react'

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
  const [evalModel, setEvalModel] = useState<string | null>(null)

  const startEval = (model: string) => setEvalModel(model)
  const stopEval = () => setEvalModel(null)

  return (
    <EvalRunContext.Provider value={{ isEvalRunning: evalModel !== null, evalModel, startEval, stopEval }}>
      {children}
    </EvalRunContext.Provider>
  )
}

export function useEvalRun() {
  return useContext(EvalRunContext)
}
