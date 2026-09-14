import { useState } from 'react'
import type { Edge, Node } from 'reactflow'
import type { ArchNodeData } from './ArchNode'
import { COMPONENT_LIBRARY, type ComponentType } from './nodes'
import { runSimulation, type InjectedFailure, type SimulationSummary } from '../lib/api'
import { estimateTotalMonthlyCost, replicasOf } from '../lib/cost'

interface Props {
  node: Node<ArchNodeData>
  nodes: Node<ArchNodeData>[]
  edges: Edge[]
  targetRps: number
  failures: InjectedFailure[]
  onApply: (newType: ComponentType) => void
  onClose: () => void
}

interface Side {
  type: ComponentType
  summary: SimulationSummary
  monthlyCost: number
}

function toPayload(nodes: Node<ArchNodeData>[]) {
  return nodes.map((n) => ({ id: n.id, type: n.data.componentType, config: n.data.config }))
}

function withSwappedType(nodes: Node<ArchNodeData>[], nodeId: string, newType: ComponentType): Node<ArchNodeData>[] {
  const def = COMPONENT_LIBRARY.find((c) => c.type === newType)
  return nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          data: {
            ...n.data,
            componentType: newType,
            config: { ...(def?.defaultConfig ?? {}) },
            // Stale tick-derived state from the old type must not leak into the hypothetical swap —
            // e.g. a leftover live replica count from an autoScalingGroup would corrupt the cost/
            // capacity math for whatever type it gets swapped to.
            replicas: undefined,
            metrics: undefined,
            hasFailure: false,
            health: 'idle',
          },
        }
      : n,
  )
}

function costOf(nodes: Node<ArchNodeData>[]): number {
  return estimateTotalMonthlyCost(
    nodes.map((n) => ({
      type: n.data.componentType as ComponentType,
      replicas: replicasOf(n.data.componentType, n.data.config, n.data.replicas),
      config: n.data.config
    })),
  )
}

const METRIC_ROWS: { label: string; pick: (s: SimulationSummary) => number; unit: string; lowerIsBetter: boolean }[] = [
  { label: 'p95 latency', pick: (s) => s.avgP95, unit: 'ms', lowerIsBetter: true },
  { label: 'Error rate', pick: (s) => s.avgErrorRatePct, unit: '%', lowerIsBetter: true },
  { label: 'Avg throughput', pick: (s) => s.avgRps, unit: ' rps', lowerIsBetter: false },
  { label: 'Bottleneck load', pick: (s) => s.bottleneckLoadPct, unit: '%', lowerIsBetter: true },
  { label: 'Single points of failure', pick: (s) => s.singlePointsOfFailure.length, unit: '', lowerIsBetter: true },
]

export default function CompareModal({ node, nodes, edges, targetRps, failures, onApply, onClose }: Props) {
  const currentType = node.data.componentType as ComponentType
  const alternatives = COMPONENT_LIBRARY.filter((c) => c.type !== currentType)
  const [selectedType, setSelectedType] = useState<ComponentType>(alternatives[0]?.type ?? currentType)
  const [isComparing, setIsComparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<Side | null>(null)
  const [alternative, setAlternative] = useState<Side | null>(null)

  const runCompare = async () => {
    setIsComparing(true)
    setError(null)
    try {
      const altNodes = withSwappedType(nodes, node.id, selectedType)
      const edgePayload = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
      const [currentResult, altResult] = await Promise.all([
        runSimulation({ nodes: toPayload(nodes), edges: edgePayload, targetRps, durationSeconds: 3, injectedFailures: failures }),
        runSimulation({ nodes: toPayload(altNodes), edges: edgePayload, targetRps, durationSeconds: 3, injectedFailures: failures }),
      ])
      setCurrent({ type: currentType, summary: currentResult.summary, monthlyCost: costOf(nodes) })
      setAlternative({ type: selectedType, summary: altResult.summary, monthlyCost: costOf(altNodes) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Comparison failed')
    } finally {
      setIsComparing(false)
    }
  }

  const labelFor = (type: ComponentType) => COMPONENT_LIBRARY.find((c) => c.type === type)?.label ?? type

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 dark:bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Compare alternative</h3>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              See what happens if <b>{node.data.label}</b> ({labelFor(currentType)}) were something else.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
        </div>

        <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Try instead
          <select
            value={selectedType}
            onChange={(e) => { setSelectedType(e.target.value as ComponentType); setCurrent(null); setAlternative(null) }}
            className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-sm text-zinc-700 dark:text-zinc-200 outline-none focus:border-violet-400"
          >
            {alternatives.map((c) => <option key={c.type} value={c.type}>{c.label}</option>)}
          </select>
        </label>

        <button onClick={runCompare} disabled={isComparing} className="mt-4 w-full rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50">
          {isComparing ? 'Simulating both…' : 'Run comparison'}
        </button>

        {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}

        {current && alternative && (
          <div className="mt-5">
            <div className="grid grid-cols-3 gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              <span>Metric</span>
              <span className="text-center">{labelFor(current.type)}</span>
              <span className="text-center text-violet-600 dark:text-violet-400">{labelFor(alternative.type)}</span>
            </div>
            <div className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800 rounded-xl border border-zinc-100 dark:border-zinc-800">
              {METRIC_ROWS.map((row) => {
                const a = row.pick(current.summary)
                const b = row.pick(alternative.summary)
                const better = row.lowerIsBetter ? b < a : b > a
                const worse = row.lowerIsBetter ? b > a : b < a
                return (
                  <div key={row.label} className="grid grid-cols-3 items-center gap-2 px-3 py-2 text-sm">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{row.label}</span>
                    <span className="text-center text-zinc-700 dark:text-zinc-300">{Math.round(a * 100) / 100}{row.unit}</span>
                    <span className={`text-center font-semibold ${better ? 'text-emerald-600 dark:text-emerald-400' : worse ? 'text-red-500 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                      {Math.round(b * 100) / 100}{row.unit}
                    </span>
                  </div>
                )
              })}
              <div className="grid grid-cols-3 items-center gap-2 px-3 py-2 text-sm">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Est. monthly cost</span>
                <span className="text-center text-zinc-700 dark:text-zinc-300">${current.monthlyCost.toLocaleString()}</span>
                <span className={`text-center font-semibold ${alternative.monthlyCost < current.monthlyCost ? 'text-emerald-600 dark:text-emerald-400' : alternative.monthlyCost > current.monthlyCost ? 'text-red-500 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                  ${alternative.monthlyCost.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">Cancel</button>
              <button onClick={() => onApply(selectedType)} className="btn-dark rounded-xl px-4 py-2 text-sm font-semibold">
                Apply {labelFor(selectedType)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
