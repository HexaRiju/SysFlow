import { useCallback, useEffect, useRef, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import type { InjectedFailure, SimulationResult, Tick, NodeTickStats, EdgeTickStats, GlobalTickStats, SimulationSummary } from './api'
import type { ArchNodeData } from '../components/ArchNode'
import { deriveHealth } from '../components/nodes'

const BASE_TICK_PLAYBACK_MS = 150
const TICKS_PER_SECOND = 10
const MAX_HISTORY_TICKS = 300

export interface BustedInfo {
  nodeId: string
  nodeLabel: string
  tick: number
  rps: number
  capacity: number
  reason: string
}

interface EngineState {
  tickCount: number
  queues: Record<string, number>
  overloadTicks: Record<string, number>
  downNodes: Set<string>
  asgReplicas: Record<string, number>
  ticksHistory: Tick[]
  latencyObservations: number[]
  sumRps: number
  sumErrorRate: number
  maxLoadByNode: Record<string, number>
  busted: boolean
  bustedInfo: BustedInfo | null
  bustedHoldTicks: number
}

function getTopologicalOrder(nodes: Node<ArchNodeData>[], edges: Edge[]): Node<ArchNodeData>[] {
  const inDegree: Record<string, number> = {}
  const outgoing: Record<string, string[]> = {}

  for (const n of nodes) {
    inDegree[n.id] = 0
    outgoing[n.id] = []
  }
  for (const e of edges) {
    if (inDegree[e.target] !== undefined) {
      inDegree[e.target] = (inDegree[e.target] || 0) + 1
    }
    if (outgoing[e.source]) {
      outgoing[e.source].push(e.target)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of Object.entries(inDegree)) {
    if (deg === 0) queue.push(id)
  }

  const order: Node<ArchNodeData>[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const node = nodes.find((n) => n.id === id)
    if (node) order.push(node)

    for (const target of outgoing[id] || []) {
      inDegree[target] = (inDegree[target] || 1) - 1
      if (inDegree[target] === 0) {
        queue.push(target)
      }
    }
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) order.push(n)
  }

  return order
}

function getNodeCapacityRps(node: Node<ArchNodeData>, replicas = 1): number {
  const type = node.data.componentType
  const config = node.data.config || {}

  switch (type) {
    case 'client':
    case 'mobile':
    case 'webBrowser':
    case 'iotDevice':
    case 'dns':
      return Infinity
    case 'cdn':
      return Number(config.maxThroughput ?? 5000)
    case 'loadBalancer':
      return Number(config.maxThroughput ?? 1000)
    case 'apiGateway':
      return Number(config.rateLimit ?? 500)
    case 'waf':
      return Number(config.maxThroughput ?? 2000)
    case 'ingress':
      return Number(config.maxThroughput ?? 1500)
    case 'service': {
      const concurrency = Number(config.maxConcurrency ?? 500)
      const minLat = Number(config.minLatencyMs ?? 20)
      const maxLat = Number(config.maxLatencyMs ?? 80)
      const avgLatSec = ((minLat + maxLat) / 2) / 1000
      return Math.round(concurrency / Math.max(0.001, avgLatSec))
    }
    case 'worker': {
      const concurrency = Number(config.maxConcurrency ?? 300)
      return Math.round(concurrency / 0.05)
    }
    case 'serverless': {
      const concurrency = Number(config.maxConcurrency ?? 1000)
      return Math.round(concurrency / 0.04)
    }
    case 'autoScalingGroup':
    case 'containerOrchestrator': {
      const baseConcurrency = Number(config.baseCapacityPerReplica ?? config.maxConcurrency ?? 500)
      const rpsPerReplica = Math.round(baseConcurrency / 0.05)
      return rpsPerReplica * replicas
    }
    case 'cronJob':
      return 500
    case 'cache':
      return 10000
    case 'database':
      return Number(config.maxConnections ?? 200) * (1 + Number(config.replicaCount ?? 0))
    case 'dataWarehouse':
      return Number(config.maxConnections ?? 100) * (1 + Number(config.replicaCount ?? 0))
    case 'queue':
      return Number(config.maxThroughput ?? 1000)
    case 'objectStorage':
      return Number(config.maxThroughput ?? 3000)
    case 'searchIndex':
      return Number(config.maxConnections ?? 300) * (1 + Number(config.replicaCount ?? 0))
    case 'dataLake':
      return Number(config.maxConnections ?? 100)
    case 'messageBroker':
      return Number(config.maxThroughput ?? 2000)
    case 'eventBus':
      return Number(config.maxThroughput ?? 3000)
    case 'webhook':
      return Number(config.maxThroughput ?? 300)
    case 'monitoring':
    case 'logging':
      return Number(config.maxThroughput ?? 5000)
    case 'thirdPartyApi':
      return Number(config.maxThroughput ?? 200)
    case 'paymentGateway':
      return Number(config.maxThroughput ?? 150)
    default:
      return 1000
  }
}

function getNodeBaseLatencyMs(node: Node<ArchNodeData>, isCacheHit = false): number {
  const type = node.data.componentType
  const config = node.data.config || {}
  switch (type) {
    case 'dns':
      return Number(config.resolutionLatencyMs ?? 5)
    case 'cdn':
      return isCacheHit ? Number(config.hitLatencyMs ?? 3) : Number(config.missLatencyMs ?? 35)
    case 'cache':
      return isCacheHit ? Number(config.hitLatencyMs ?? 2) : Number(config.missLatencyMs ?? 40)
    case 'loadBalancer':
      return 1.5 + Math.random() * 1.5
    case 'apiGateway':
      return 2.5 + Math.random() * 2.5
    case 'waf':
      return Number(config.extraLatencyMs ?? 2) + Math.random() * 2
    case 'ingress':
      return 1.5 + Math.random() * 1.5
    case 'service':
    case 'worker':
    case 'serverless':
    case 'autoScalingGroup':
    case 'containerOrchestrator':
    case 'cronJob': {
      const min = Number(config.minLatencyMs ?? 20)
      const max = Number(config.maxLatencyMs ?? 80)
      return min + Math.random() * Math.max(1, max - min)
    }
    case 'database':
      return Number(config.readLatencyMs ?? 15) + Math.random() * 5
    case 'dataWarehouse':
      return Number(config.readLatencyMs ?? 60) + Math.random() * 15
    case 'objectStorage':
      return Number(config.readLatencyMs ?? 25) + Math.random() * 10
    case 'searchIndex':
      return Number(config.readLatencyMs ?? 20) + Math.random() * 8
    case 'dataLake':
      return Number(config.readLatencyMs ?? 80) + Math.random() * 20
    case 'queue':
    case 'messageBroker':
      return 5 + Math.random() * 10
    case 'eventBus':
      return 2 + Math.random() * 5
    case 'webhook':
      return Number(config.extraLatencyMs ?? 20) + Math.random() * 20
    case 'thirdPartyApi': {
      const min = Number(config.minLatencyMs ?? 50)
      const max = Number(config.maxLatencyMs ?? 400)
      return min + Math.random() * Math.max(1, max - min)
    }
    case 'paymentGateway': {
      const min = Number(config.minLatencyMs ?? 100)
      const max = Number(config.maxLatencyMs ?? 600)
      return min + Math.random() * Math.max(1, max - min)
    }
    default:
      return 5 + Math.random() * 5
  }
}

function calculatePercentile(samples: number[], p: number): number {
  if (!samples || samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return Math.round(sorted[idx] * 100) / 100
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(1, v > 1 ? v / 100.0 : v))
}

function initialEngineState(): EngineState {
  return {
    tickCount: 0,
    queues: {},
    overloadTicks: {},
    downNodes: new Set(),
    asgReplicas: {},
    ticksHistory: [],
    latencyObservations: [],
    sumRps: 0,
    sumErrorRate: 0,
    maxLoadByNode: {},
    busted: false,
    bustedInfo: null,
    bustedHoldTicks: 0,
  }
}

export function useSimulation() {
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [currentTick, setCurrentTick] = useState<Tick | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isBusted, setIsBusted] = useState(false)
  const [bustedInfo, setBustedInfo] = useState<BustedInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1)
  const [trafficMultiplier, setTrafficMultiplierState] = useState(1)

  const timerRef = useRef<number | null>(null)
  const engineRef = useRef<EngineState>(initialEngineState())
  const failuresRef = useRef<InjectedFailure[]>([])
  const trafficMultiplierRef = useRef(1)
  const graphRef = useRef<{
    nodes: Node<ArchNodeData>[]
    edges: Edge[]
    baseRps: number
  }>({ nodes: [], edges: [], baseRps: 100 })

  const stopPlayback = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const setTrafficMultiplier = useCallback((multiplier: number) => {
    setTrafficMultiplierState(multiplier)
    trafficMultiplierRef.current = multiplier
  }, [])

  const updateFailures = useCallback((failures: InjectedFailure[]) => {
    failuresRef.current = [...failures]
  }, [])

  const stepSimulation = useCallback(() => {
    const { nodes, edges, baseRps } = graphRef.current
    if (nodes.length === 0) return

    const engine = engineRef.current
    engine.tickCount++
    const t = engine.tickCount

    // Dynamic Progressive Load Ramp with live Traffic Multiplier:
    // Every simulated second (10 ticks), arrival rate increases by ~8%
    const rampMultiplier = 1 + (t * 0.008)
    const currentTargetRps = Math.min(50000, baseRps * trafficMultiplierRef.current * rampMultiplier)

    const topoOrder = getTopologicalOrder(nodes, edges)
    const clientNodes = nodes.filter((n) => n.data.componentType === 'client' || n.data.componentType === 'mobile' || n.data.componentType === 'webBrowser' || n.data.componentType === 'iotDevice')
    const effectiveClients = clientNodes.length > 0 ? clientNodes : nodes.filter((n) => edges.every((e) => e.target !== n.id))

    const perClientArrivalPerTick = (currentTargetRps / TICKS_PER_SECOND) / Math.max(1, effectiveClients.length)

    const incomingRate: Record<string, number> = {}
    const incomingFailedRate: Record<string, number> = {}
    const incomingLatencyWeighted: Record<string, number> = {}

    for (const client of effectiveClients) {
      incomingRate[client.id] = (incomingRate[client.id] || 0) + perClientArrivalPerTick
      incomingLatencyWeighted[client.id] = 0
    }

    const nodeStats: Record<string, NodeTickStats> = {}
    const edgeStats: Record<string, EdgeTickStats> = {}
    const tickLatencySamples: number[] = []

    let totalAttempted = 0
    let totalFailed = 0
    let totalSucceeded = 0

    // Topological propagation
    for (const node of topoOrder) {
      const isClient = node.data.componentType === 'client' || node.data.componentType === 'mobile' || node.data.componentType === 'webBrowser' || node.data.componentType === 'iotDevice'
      const arriving = incomingRate[node.id] || 0
      const arrivingFailed = incomingFailedRate[node.id] || 0
      const incLatency = incomingLatencyWeighted[node.id] || 0
      const avgIncomingLatency = arriving > 0 ? incLatency / arriving : 0

      // Active failure check
      const activeFailure = failuresRef.current.find(
        (f) => f.nodeId === node.id && (f.fromTick == null || f.fromTick <= t) && (f.toTick == null || f.toTick >= t),
      )
      const killedByChaos = activeFailure?.type === 'kill'
      const throttledByChaos = activeFailure?.type === 'throttle' ? clampPct(activeFailure.throttlePct ?? 60) : 0
      const extraLatencyChaos = activeFailure?.type === 'latency' ? (activeFailure.extraMs ?? 250) : 0

      // ASG scaling logic
      let replicas = engine.asgReplicas[node.id] ?? Number(node.data.config?.minReplicas ?? 1)
      if (node.data.componentType === 'autoScalingGroup' || node.data.componentType === 'containerOrchestrator') {
        const targetLoad = Number(node.data.config?.targetLoadPct ?? 70)
        const maxReplicas = Number(node.data.config?.maxReplicas ?? 10)
        const minReplicas = Number(node.data.config?.minReplicas ?? 1)
        const lastLoad = engine.maxLoadByNode[node.id] || 0

        if (lastLoad > targetLoad && replicas < maxReplicas && t % 10 === 0) {
          replicas += 1
        } else if (lastLoad < (targetLoad - 20) && replicas > minReplicas && t % 20 === 0) {
          replicas -= 1
        }
        engine.asgReplicas[node.id] = replicas
      }

      // Base capacity & effective capacity per tick
      const baseCapRps = getNodeCapacityRps(node, replicas)
      const capacityPerTick = (baseCapRps / TICKS_PER_SECOND) * (1 - throttledByChaos)

      const isAlreadyDown = engine.downNodes.has(node.id) || killedByChaos

      let accepted = 0
      let failedHere = 0
      let loadPct = 0
      let nodeLatency = 0

      if (isAlreadyDown) {
        // Crashed / Busted node
        accepted = 0
        failedHere = arriving + arrivingFailed
        loadPct = 200
        nodeLatency = 500
      } else if (isClient) {
        accepted = arriving
        failedHere = arrivingFailed
        loadPct = 0
        nodeLatency = 0
      } else {
        const currentQueue = engine.queues[node.id] || 0
        const totalArriving = arriving + currentQueue

        if (totalArriving <= capacityPerTick) {
          accepted = totalArriving
          engine.queues[node.id] = 0
          failedHere = arrivingFailed
          engine.overloadTicks[node.id] = 0
        } else {
          accepted = capacityPerTick
          const excess = totalArriving - capacityPerTick
          const maxQueueBuffer = capacityPerTick * 2.0 // stores up to 2 seconds of queue buffer

          const newQueue = Math.min(maxQueueBuffer, excess)
          const dropped = excess - newQueue
          engine.queues[node.id] = newQueue
          failedHere = arrivingFailed + dropped
          engine.overloadTicks[node.id] = (engine.overloadTicks[node.id] || 0) + 1
        }

        loadPct = capacityPerTick <= 0
          ? (totalArriving > 0 ? 200 : 0)
          : Math.min(200, (totalArriving / capacityPerTick) * 100)

        const queueDelayMs = capacityPerTick > 0 && (engine.queues[node.id] || 0) > 0
          ? ((engine.queues[node.id] / capacityPerTick) * 100)
          : 0

        const isCache = node.data.componentType === 'cache' || node.data.componentType === 'cdn'
        const hitRate = isCache ? clampPct(Number(node.data.config?.hitRatePct ?? 80) / 100) : 0
        const isHit = isCache && Math.random() < hitRate

        nodeLatency = getNodeBaseLatencyMs(node, isHit) + queueDelayMs + extraLatencyChaos

        // Check if node BUSTS at this tick
        // Sustained critical overload (>12 consecutive overloaded ticks) or queue buffer exhaustion
        if (engine.overloadTicks[node.id] >= 12 || (engine.queues[node.id] || 0) >= capacityPerTick * 2.0) {
          engine.downNodes.add(node.id)
          accepted = 0
          failedHere = arriving + arrivingFailed
          loadPct = 200

          if (!engine.busted) {
            engine.busted = true
            engine.bustedInfo = {
              nodeId: node.id,
              nodeLabel: node.data.label || node.id,
              tick: t,
              rps: Math.round(arriving * TICKS_PER_SECOND),
              capacity: Math.round(baseCapRps),
              reason: `Sustained overload exceeded component capacity (${Math.round(arriving * TICKS_PER_SECOND)} RPS > ${Math.round(baseCapRps)} max capacity)`,
            }
          }
        }
      }

      const totalIn = arriving + arrivingFailed
      const errorRatePct = totalIn <= 0 ? 0 : Math.min(100, (failedHere / totalIn) * 100)
      const cumulativeLatency = avgIncomingLatency + nodeLatency

      engine.maxLoadByNode[node.id] = Math.max(engine.maxLoadByNode[node.id] || 0, loadPct)

      const isDown = engine.downNodes.has(node.id) || killedByChaos

      nodeStats[node.id] = {
        loadPct: Math.round(loadPct * 10) / 10,
        errorRatePct: Math.round(errorRatePct * 10) / 10,
        avgLatencyMs: Math.round(nodeLatency * 10) / 10,
        down: isDown,
        replicas,
      }

      // Outgoing edges propagation
      const outEdges = edges.filter((e) => e.source === node.id)
      if (outEdges.length > 0) {
        // Realistic Cache / CDN traffic shedding:
        // Cache hits terminate here successfully and are NOT forwarded downstream!
        let trafficToForward = accepted
        if ((node.data.componentType === 'cache' || node.data.componentType === 'cdn') && !isDown) {
          const hitRate = clampPct(Number(node.data.config?.hitRatePct ?? 80) / 100)
          trafficToForward = accepted * (1 - hitRate)
        }

        const sharePerEdge = trafficToForward / outEdges.length
        const failedSharePerEdge = failedHere / Math.max(1, outEdges.length)

        for (const edge of outEdges) {
          const edgeFailure = failuresRef.current.find((f) => f.edgeId === edge.id)
          const dropPct = edgeFailure?.dropPct ? clampPct(edgeFailure.dropPct) : 0

          const dropped = sharePerEdge * dropPct
          const forwarded = sharePerEdge - dropped

          incomingRate[edge.target] = (incomingRate[edge.target] || 0) + forwarded
          incomingFailedRate[edge.target] = (incomingFailedRate[edge.target] || 0) + failedSharePerEdge + dropped
          incomingLatencyWeighted[edge.target] = (incomingLatencyWeighted[edge.target] || 0) + (forwarded * cumulativeLatency)

          edgeStats[edge.id] = {
            inFlight: Math.round(forwarded * 10) / 10,
            avgLatencyMs: Math.round(cumulativeLatency * 10) / 10,
          }
        }
      } else if (!isClient) {
        // Terminal node (e.g. database, external service)
        totalAttempted += arriving + arrivingFailed
        totalFailed += failedHere
        totalSucceeded += accepted

        const sampleCount = Math.min(20, Math.round(accepted))
        for (let i = 0; i < sampleCount; i++) {
          tickLatencySamples.push(cumulativeLatency)
          engine.latencyObservations.push(cumulativeLatency)
        }
      }
    }

    const tickRps = totalSucceeded * TICKS_PER_SECOND
    const tickErrorRate = totalAttempted <= 0 ? 0 : Math.min(100, (totalFailed / totalAttempted) * 100)
    const p50 = calculatePercentile(tickLatencySamples, 0.5)
    const p95 = calculatePercentile(tickLatencySamples, 0.95)
    const p99 = calculatePercentile(tickLatencySamples, 0.99)

    engine.sumRps += tickRps
    engine.sumErrorRate += tickErrorRate

    const globalStats: GlobalTickStats = {
      rps: Math.round(tickRps),
      errorRatePct: Math.round(tickErrorRate * 10) / 10,
      p50,
      p95,
      p99,
    }

    const newTick: Tick = {
      t,
      nodes: nodeStats,
      edges: edgeStats,
      global: globalStats,
    }

    engine.ticksHistory.push(newTick)
    if (engine.ticksHistory.length > MAX_HISTORY_TICKS) {
      engine.ticksHistory.shift()
    }

    // Update Summary
    let bottleneckId: string | null = null
    let maxLoad = 0
    for (const [id, load] of Object.entries(engine.maxLoadByNode)) {
      if (load > maxLoad) {
        maxLoad = load
        bottleneckId = id
      }
    }
    if (engine.bustedInfo) {
      bottleneckId = engine.bustedInfo.nodeId
    }

    const spofs = nodes
      .filter((n) => !['client', 'mobile', 'webBrowser', 'iotDevice'].includes(n.data.componentType))
      .filter((n) => edges.some((e) => e.target === n.id))
      .filter((n) => {
        if (n.data.componentType === 'database' || n.data.componentType === 'searchIndex') {
          return Number(n.data.config?.replicaCount ?? 0) <= 0
        }
        return ['service', 'cache', 'queue', 'messageBroker', 'dataWarehouse'].includes(n.data.componentType)
      })
      .map((n) => n.id)

    const summary: SimulationSummary = {
      avgRps: Math.round(engine.sumRps / engine.tickCount),
      avgErrorRatePct: Math.round((engine.sumErrorRate / engine.tickCount) * 10) / 10,
      avgP95: calculatePercentile(engine.latencyObservations.slice(-200), 0.95),
      bottleneckNodeId: bottleneckId,
      bottleneckLoadPct: Math.round(maxLoad * 10) / 10,
      singlePointsOfFailure: spofs,
    }

    setCurrentTick(newTick)
    setResult({
      ticks: [...engine.ticksHistory],
      summary,
    })

    if (engine.busted) {
      setIsBusted(true)
      setBustedInfo(engine.bustedInfo)
      engine.bustedHoldTicks++

      // Hold in busted state for 15 ticks so user visually sees the cascading red disaster,
      // then pause playback automatically at the failure point
      if (engine.bustedHoldTicks >= 15) {
        stopPlayback()
      }
    }
  }, [stopPlayback])

  const run = useCallback(
    (
      nodes: Node<ArchNodeData>[],
      edges: Edge[],
      targetRps: number,
      _durationSeconds?: number,
      injectedFailures: InjectedFailure[] = [],
    ) => {
      stopPlayback()
      setIsRunning(true)
      setError(null)
      setIsBusted(false)
      setBustedInfo(null)

      engineRef.current = initialEngineState()
      failuresRef.current = [...injectedFailures]
      graphRef.current = { nodes, edges, baseRps: targetRps }

      setIsPlaying(true)
      setIsRunning(false)
    },
    [stopPlayback],
  )

  const reset = useCallback(() => {
    stopPlayback()
    engineRef.current = initialEngineState()
    setResult(null)
    setCurrentTick(null)
    setIsBusted(false)
    setBustedInfo(null)
    setError(null)
  }, [stopPlayback])

  useEffect(() => {
    if (!isPlaying) return
    const intervalMs = BASE_TICK_PLAYBACK_MS / speed
    timerRef.current = window.setInterval(stepSimulation, intervalMs)
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
      }
    }
  }, [isPlaying, speed, stepSimulation])

  const nodeHealth = useCallback(
    (nodeId: string) => {
      const stats = currentTick?.nodes[nodeId]
      if (!stats) return 'idle' as const
      return deriveHealth(stats.loadPct, stats.errorRatePct, stats.down)
    },
    [currentTick],
  )

  const edgeStats = useCallback(
    (edgeId: string) => {
      return currentTick?.edges[edgeId] ?? null
    },
    [currentTick],
  )

  return {
    result,
    currentTick,
    isPlaying,
    isRunning,
    isBusted,
    bustedInfo,
    error,
    speed,
    setSpeed,
    trafficMultiplier,
    setTrafficMultiplier,
    run,
    pause: stopPlayback,
    resume: () => {
      if (engineRef.current.tickCount > 0) {
        setIsPlaying(true)
      }
    },
    reset,
    updateFailures,
    nodeHealth,
    edgeStats,
  }
}
