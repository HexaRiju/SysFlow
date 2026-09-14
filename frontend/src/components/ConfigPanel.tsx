import { useEffect, useMemo, useState } from 'react'
import type { Node } from 'reactflow'
import { COMPONENT_LIBRARY, type ComponentType } from './nodes'
import { COMPONENT_ICONS } from './icons'
import type { ArchNodeData } from './ArchNode'
import { estimateNodeMonthlyCost, replicasOf } from '../lib/cost'

interface Props {
  node: Node<ArchNodeData> | null
  onChange: (nodeId: string, config: Record<string, unknown>) => void
  onDelete: (nodeId: string) => void
  onClose: () => void
}

type Tab = 'configure' | 'metrics' | 'logs'

function labelForKey(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/Ms\b/g, 'ms')
    .replace(/Pct\b/g, '%')
    .replace(/^./, (s) => s.toUpperCase())
}

export default function ConfigPanel({ node, onChange, onDelete, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('configure')
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const def = useMemo(() => COMPONENT_LIBRARY.find((c) => c.type === node?.data.componentType), [node?.data.componentType])
  const Icon = node ? COMPONENT_ICONS[node.data.componentType as keyof typeof COMPONENT_ICONS] : null
  const config = (node?.data.config ?? def?.defaultConfig ?? {}) as Record<string, unknown>

  useEffect(() => {
    if (!node) return
    setDraft({ ...config, __label: node.data.label })
    setTab('configure')
    setAdvancedOpen(false)
  }, [node?.id])

  if (!node) return null

  const setField = (key: string, value: string) => {
    const parsed = value === '' ? '' : isNaN(Number(value)) ? value : Number(value)
    setDraft((current) => ({ ...current, [key]: parsed }))
  }

  const apply = () => onChange(node.id, draft)

  const metrics = node.data.metrics
  const health = node.data.health ?? 'idle'
  const healthLabel = health === 'underLoad' ? 'Warning' : health === 'critical' ? 'Critical' : health === 'down' ? 'Down' : health === 'healthy' ? 'Healthy' : 'Ready'

  const primaryFields = [
    ...(Object.prototype.hasOwnProperty.call(draft, 'scale') ? [{ key: 'scale', label: 'Memory Scale' }] : []),
    ...(Object.prototype.hasOwnProperty.call(draft, 'maxThroughput') ? [{ key: 'maxThroughput', label: 'Capacity (RPS)' }] : []),
    ...(Object.prototype.hasOwnProperty.call(draft, 'maxConcurrency') ? [{ key: 'maxConcurrency', label: 'Capacity' }] : []),
    ...(Object.prototype.hasOwnProperty.call(draft, 'minLatencyMs') ? [{ key: 'minLatencyMs', label: 'Latency (ms)' }] : []),
    ...(Object.prototype.hasOwnProperty.call(draft, 'readLatencyMs') ? [{ key: 'readLatencyMs', label: 'Read Latency (ms)' }] : []),
    ...(Object.prototype.hasOwnProperty.call(draft, 'writeLatencyMs') ? [{ key: 'writeLatencyMs', label: 'Write Latency (ms)' }] : []),
    ...(Object.prototype.hasOwnProperty.call(draft, 'failureRateAtSaturation') ? [{ key: 'failureRateAtSaturation', label: 'Failure Rate (%)' }] : []),
    ...(Object.prototype.hasOwnProperty.call(draft, 'replicaCount') ? [{ key: 'replicaCount', label: 'Instances' }] : []),
  ]

  const nodeCost = node ? estimateNodeMonthlyCost(node.data.componentType as ComponentType, replicasOf(node.data.componentType, draft), draft) : 0

  return (
    <>
      <div className="fixed inset-0 z-30 bg-zinc-900/20 dark:bg-black/50 md:hidden" onClick={onClose} />
      <aside className="config-sidebar panel-slide-in fixed inset-x-0 bottom-0 z-40 flex h-[70vh] flex-col rounded-t-2xl border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl md:static md:z-auto md:h-full md:w-[300px] md:shrink-0 md:rounded-none md:border-t-0 md:border-l md:shadow-none">
      <div className="border-b border-zinc-100 dark:border-zinc-800 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400">{Icon && <Icon width={18} height={18} />}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{node.data.label}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: health === 'underLoad' ? '#f59e0b' : health === 'critical' || health === 'down' ? '#ef4444' : '#22c55e' }} />
                <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">{healthLabel}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-zinc-100 dark:border-zinc-800 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {(['configure', 'metrics', 'logs'] as Tab[]).map((item) => (
          <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-2 py-3 ${tab === item ? 'border-violet-600 text-violet-600 dark:text-violet-400' : 'border-transparent hover:text-zinc-600 dark:hover:text-zinc-300'}`}>
            {item}
          </button>
        ))}
      </div>

      {tab === 'configure' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 p-3">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Type</p>
              <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-100">{def?.label ?? node.data.componentType}</p>
            </div>
            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 p-3">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Est. Cost</p>
              <p className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                ${nodeCost.toFixed(0)}<span className="text-[10px] font-normal text-zinc-400">/mo</span>
              </p>
            </div>
          </div>

          <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Name
            <input value={String(draft.__label ?? node.data.label)} onChange={(e) => setDraft((current) => ({ ...current, __label: e.target.value }))} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-zinc-800 dark:text-zinc-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40" />
          </label>

          <div className="mt-4 space-y-3">
            {primaryFields.map(({ key, label }) => (
              <label key={key} className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                {label}
                {key === 'scale' ? (
                  <select value={String(draft[key] ?? 'Auto')} onChange={(e) => setField(key, e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-zinc-800 dark:text-zinc-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40">
                    <option value="Auto">Auto-sized from Load</option>
                    <option value="XS_2GB">2GB (Extra Small)</option>
                    <option value="SM_4GB">4GB (Small)</option>
                    <option value="MD_8GB">8GB (Medium)</option>
                    <option value="LG_16GB">16GB (Large)</option>
                    <option value="XL_32GB">32GB (Extra Large)</option>
                  </select>
                ) : (
                  <input type={typeof draft[key] === 'number' ? 'number' : 'text'} value={String(draft[key] ?? '')} onChange={(e) => setField(key, e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-zinc-800 dark:text-zinc-100 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40" />
                )}
              </label>
            ))}
          </div>

          <button onClick={() => setAdvancedOpen((open) => !open)} className="mt-5 flex w-full items-center justify-between border-t border-zinc-100 dark:border-zinc-800 pt-4 text-left text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Advanced <span>{advancedOpen ? '⌃' : '⌄'}</span>
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-3">
              {Object.entries(draft).filter(([key]) => key !== '__label' && !primaryFields.some((field) => field.key === key)).map(([key, value]) => (
                <label key={key} className="block text-[10px] font-semibold tracking-wide text-zinc-400 dark:text-zinc-500">
                  {labelForKey(key)}
                  <input value={String(value)} onChange={(e) => setField(key, e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40" />
                </label>
              ))}
            </div>
          )}

          <button onClick={apply} className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700">Apply changes</button>
          <button onClick={() => onDelete(node.id)} className="mt-2 w-full rounded-xl border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50">Delete node</button>
        </div>
      )}

      {tab === 'metrics' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 p-3"><p className="text-[9px] uppercase text-zinc-400 dark:text-zinc-500">CPU</p><p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{Math.round(metrics?.cpu ?? 0)}%</p></div>
            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 p-3"><p className="text-[9px] uppercase text-zinc-400 dark:text-zinc-500">Latency</p><p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{Math.round(metrics?.latency ?? 0)}ms</p></div>
            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 p-3"><p className="text-[9px] uppercase text-zinc-400 dark:text-zinc-500">RPS</p><p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{Math.round(metrics?.rps ?? 0)}</p></div>
            <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 p-3"><p className="text-[9px] uppercase text-zinc-400 dark:text-zinc-500">Instances</p><p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{node.data.replicas ?? 1}</p></div>
          </div>
          <div className="mt-4 rounded-xl border border-zinc-100 dark:border-zinc-800 p-3 text-xs text-zinc-500 dark:text-zinc-400">Metrics update live while a simulation is running.</div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-2 text-xs">
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/60 p-3"><span className="font-semibold text-emerald-600 dark:text-emerald-400">READY</span><p className="mt-1 text-zinc-500 dark:text-zinc-400">Node is available for simulation.</p></div>
            {node.data.hasFailure && <div className="rounded-xl bg-red-50 dark:bg-red-950/30 p-3"><span className="font-semibold text-red-600 dark:text-red-400">CHAOS</span><p className="mt-1 text-red-500 dark:text-red-400">A failure is currently injected into this node.</p></div>}
          </div>
        </div>
      )}
      </aside>
    </>
  )
}
