import { useState } from 'react'
import type { Edge, Node } from 'reactflow'
import type { ArchNodeData } from './ArchNode'
import { evaluateSlo, runSimulation, type InjectedFailure, type SloEvaluationResult, type SloRequirement } from '../lib/api'

interface Props {
  nodes: Node<ArchNodeData>[]
  edges: Edge[]
  targetRps: number
  failures: InjectedFailure[]
  onClose: () => void
}

interface ThresholdField {
  key: keyof SloRequirement
  label: string
  unit: string
  placeholder: string
}

const FIELDS: ThresholdField[] = [
  { key: 'maxP95LatencyMs', label: 'Maximum p95 latency', unit: 'ms', placeholder: 'e.g. 200' },
  { key: 'maxErrorRatePercent', label: 'Maximum error rate', unit: '%', placeholder: 'e.g. 1' },
  { key: 'minThroughputRps', label: 'Minimum throughput', unit: 'rps', placeholder: 'e.g. 500' },
]

const CHECK_LABEL: Record<string, string> = {
  maxP95LatencyMs: 'p95 latency',
  maxErrorRatePercent: 'Error rate',
  minThroughputRps: 'Throughput',
}

// Matches the node/edge payload shape built inline at every other backend call site
// in this codebase (CompareModal's toPayload, EditorPage's toggleRealPricing) — there is
// no shared helper for it to reuse, so this mirrors the existing convention rather than
// introducing a new one.
function toPayload(nodes: Node<ArchNodeData>[]) {
  return nodes.map((n) => ({ id: n.id, type: n.data.componentType, config: n.data.config }))
}

export default function SloPanel({ nodes, edges, targetRps, failures, onClose }: Props) {
  // Each threshold is a raw string so a field can be left truly empty/disabled
  // without the number input coercing it to 0.
  const [thresholds, setThresholds] = useState<Record<keyof SloRequirement, string>>({
    maxP95LatencyMs: '',
    maxErrorRatePercent: '',
    minThroughputRps: '',
  })
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SloEvaluationResult | null>(null)

  const hasArchitecture = nodes.length > 0
  const anyThresholdSet = Object.values(thresholds).some((v) => v.trim() !== '')

  const setField = (key: keyof SloRequirement, value: string) => {
    setThresholds((prev) => ({ ...prev, [key]: value }))
  }

  const runEvaluation = async () => {
    if (!hasArchitecture) {
      setError('Add at least one component to the canvas before evaluating SLOs.')
      return
    }
    if (!anyThresholdSet) {
      setError('Set at least one SLO threshold to evaluate.')
      return
    }

    setIsEvaluating(true)
    setError(null)
    setResult(null)
    try {
      const edgePayload = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))

      // Authoritative simulation first — the backend SimulationEngine is the source of
      // truth for the metrics being checked, never the client-side useSimulation result.
      const simulationResult = await runSimulation({
        nodes: toPayload(nodes),
        edges: edgePayload,
        targetRps,
        durationSeconds: 3,
        injectedFailures: failures,
      }).catch(() => {
        throw new Error('Could not run the simulation — the backend may be unreachable.')
      })

      const sloRequirement: SloRequirement = {
        maxP95LatencyMs: thresholds.maxP95LatencyMs.trim() === '' ? null : Number(thresholds.maxP95LatencyMs),
        maxErrorRatePercent: thresholds.maxErrorRatePercent.trim() === '' ? null : Number(thresholds.maxErrorRatePercent),
        minThroughputRps: thresholds.minThroughputRps.trim() === '' ? null : Number(thresholds.minThroughputRps),
      }

      const evaluation = await evaluateSlo(simulationResult, sloRequirement).catch(() => {
        throw new Error('Simulation succeeded, but SLO evaluation failed — the backend may be unreachable.')
      })

      setResult(evaluation)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SLO evaluation failed')
    } finally {
      setIsEvaluating(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-zinc-900/20 dark:bg-black/50 md:hidden" onClick={onClose} />
      <aside className="analysis-sidebar panel-slide-in fixed inset-x-0 bottom-0 z-40 flex h-[75vh] flex-col rounded-t-2xl border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl md:static md:z-auto md:h-full md:w-[330px] md:shrink-0 md:rounded-none md:border-t-0 md:border-l md:shadow-none">
        <div className="border-b border-zinc-100 dark:border-zinc-800 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">SLO evaluation</p>
              <h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">Evaluate SLOs</h2>
              <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">Runs a fresh backend simulation, then checks it against your thresholds.</p>
            </div>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
          </div>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="space-y-3">
            {FIELDS.map((field) => (
              <label key={field.key} className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {field.label}
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="number"
                    value={thresholds[field.key]}
                    onChange={(e) => setField(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-sm normal-case text-zinc-700 dark:text-zinc-200 outline-none focus:border-violet-400"
                  />
                  <span className="w-8 shrink-0 text-[10px] normal-case text-zinc-400">{field.unit}</span>
                  {thresholds[field.key] !== '' && (
                    <button
                      type="button"
                      onClick={() => setField(field.key, '')}
                      className="shrink-0 text-[10px] normal-case font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      Disable
                    </button>
                  )}
                </div>
              </label>
            ))}
          </div>

          <button
            onClick={runEvaluation}
            disabled={isEvaluating}
            className="mt-4 w-full rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50"
          >
            {isEvaluating ? 'Running simulation & evaluating…' : 'Evaluate'}
          </button>

          {error && (
            <div className="mt-3 rounded-xl border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-5">
              <div
                className={`rounded-xl border p-3 text-xs font-semibold ${
                  result.overallStatus === 'PASS'
                    ? 'border-emerald-100 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                    : 'border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400'
                }`}
              >
                {result.overallStatus === 'PASS' ? '✓ All configured SLOs passed' : '✕ One or more SLOs failed'}
              </div>

              {result.checks.length === 0 ? (
                <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">No SLOs were configured for this evaluation.</p>
              ) : (
                <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-100 dark:border-zinc-800">
                  {result.checks.map((check) => (
                    <div key={check.name} className="p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{CHECK_LABEL[check.name] ?? check.name}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            check.status === 'PASS'
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                              : 'bg-red-50 dark:bg-red-950/30 text-red-500 dark:text-red-400'
                          }`}
                        >
                          {check.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        Actual: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{check.actualValue}</span>
                        {' · '}Threshold: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{check.thresholdValue}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
