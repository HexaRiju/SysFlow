import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useEdgesState, useNodesState, type Edge, type Node } from 'reactflow'
import Canvas from '../components/Canvas'
import FindingsPanel from '../components/FindingsPanel'
import type { ArchNodeData } from '../components/ArchNode'
import { useSimulation } from '../lib/useSimulation'
import { useAuth } from '../lib/AuthContext'
import { analyzeGraph, compareMultiCloudCosts, estimateRealCost, getScaleTiers, gradeInterview, importSrs, listInterviewPrompts, type AnalyzeResult, type InjectedFailure, type InterviewGrade, type InterviewPrompt, type PricingCompareResponse, type PricingEstimate, type ScalePricingResponse, type SrsImportResult } from '../lib/api'
import { ClockIcon, PacketDropIcon, SkullIcon, ThrottleIcon } from '../components/icons'
import { createProject, getProject, getPublicProject, listVersions, restoreVersion, updateProject, type ProjectVersionSummary } from '../lib/projects'
import { TEMPLATES } from '../lib/templates'
import { useHistory } from '../lib/useHistory'
import { stashPendingSave, takePendingSave } from '../lib/pendingSave'
import { estimateTotalMonthlyCost, replicasOf } from '../lib/cost'
import { generateDockerCompose } from '../lib/iac'
import { generateReport } from '../lib/report'
import { createComment, deleteComment, listComments, type NodeComment } from '../lib/comments'
import { useCollabSession } from '../lib/collab'
import { COMPONENT_LIBRARY, type ComponentType } from '../components/nodes'
import CompareModal from '../components/CompareModal'
import SrsDiffModal from '../components/SrsDiffModal'
import ThemeToggle from '../components/ThemeToggle'
import logo from '../assets/logo.png'

const SPEED_OPTIONS = [0.5, 1, 2, 4]
const TRAFFIC_OPTIONS = [0.5, 1, 2.5, 5]
const RPS_PRESETS = [100, 500, 1000, 5000, 10000]

type ChaosType = InjectedFailure['type']

const CHAOS_TYPES: { type: ChaosType; label: string; Icon: typeof SkullIcon }[] = [
  { type: 'kill', label: 'Kill Node', Icon: SkullIcon },
  { type: 'latency', label: 'Add Latency', Icon: ClockIcon },
  { type: 'dropPct', label: 'Drop Packets', Icon: PacketDropIcon },
  { type: 'throttle', label: 'Reduce Capacity', Icon: ThrottleIcon },
]

function toGraphNodes(nodes: Node<ArchNodeData>[]) {
  return nodes.map((n) => ({
    id: n.id,
    type: n.data.componentType,
    config: n.data.config,
    position: n.position,
    label: n.data.label,
  }))
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function EditorPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<ArchNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [baseRps, setBaseRps] = useState(100)
  const [traffic, setTraffic] = useState(1)
  const [failures, setFailures] = useState<InjectedFailure[]>([])
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; token: number } | null>(null)
  const [exportRequest, setExportRequest] = useState(0)
  const [brandedExportRequest, setBrandedExportRequest] = useState(0)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('Untitled Project')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveDraftName, setSaveDraftName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [isLoadingProject, setIsLoadingProject] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isImportingSrs, setIsImportingSrs] = useState(false)
  const [srsUnrecognized, setSrsUnrecognized] = useState<string[]>([])
  const srsFileInputRef = useRef<HTMLInputElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<ProjectVersionSummary[]>([])
  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null)
  const [compareNodeId, setCompareNodeId] = useState<string | null>(null)
  const [realPricing, setRealPricing] = useState<PricingEstimate | null>(null)
  const [multiCloudPricing, setMultiCloudPricing] = useState<PricingCompareResponse | null>(null)
  const [scaleTiers, setScaleTiers] = useState<ScalePricingResponse | null>(null)
  const [pricingTab, setPricingTab] = useState<'all' | 'aws' | 'gcp' | 'azure' | 'scale'>('all')
  const [pricingCostMode, setPricingCostMode] = useState<'endToEnd' | 'provisioned'>('endToEnd')
  const [isLoadingRealPricing, setIsLoadingRealPricing] = useState(false)
  const [realPricingOpen, setRealPricingOpen] = useState(false)
  const [realPricingError, setRealPricingError] = useState<string | null>(null)
  const [interviewPrompt, setInterviewPrompt] = useState<InterviewPrompt | null>(null)
  const [interviewGrade, setInterviewGrade] = useState<InterviewGrade | null>(null)
  const [isGrading, setIsGrading] = useState(false)
  const [gradingError, setGradingError] = useState<string | null>(null)
  const [pendingSrsImport, setPendingSrsImport] = useState<{ result: SrsImportResult; fileName: string } | null>(null)
  const [chaosOpen, setChaosOpen] = useState(false)
  const [chaosType, setChaosType] = useState<ChaosType>('kill')
  const [chaosTarget, setChaosTarget] = useState('')
  const [chaosLatency, setChaosLatency] = useState(100)
  const [chaosDrop, setChaosDrop] = useState(10)
  const [chaosThrottle, setChaosThrottle] = useState(50)
  const [comments, setComments] = useState<NodeComment[]>([])
  const [commentNodeId, setCommentNodeId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [isPostingComment, setIsPostingComment] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)

  const sim = useSimulation()
  const auth = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const loadedRef = useRef(false)
  const history = useHistory(nodes, edges, setNodes, setEdges)
  const collab = useCollabSession(projectId, auth.user?.displayName ?? null)
  const applyingRemoteGraphRef = useRef(false)

  collab.onRemoteGraph((payload) => {
    applyingRemoteGraphRef.current = true
    setNodes(payload.nodes.map((n) => ({
      id: n.id,
      type: 'archNode',
      position: n.position,
      data: { componentType: n.type, label: n.label, config: n.config, health: 'idle' },
    })))
    setEdges(payload.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
  })

  useEffect(() => {
    if (!projectId) return
    if (applyingRemoteGraphRef.current) {
      applyingRemoteGraphRef.current = false
      return
    }
    collab.broadcastGraph({
      nodes: nodes.map((n) => ({ id: n.id, type: n.data.componentType, label: n.data.label, config: n.data.config, position: n.position })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, projectId])

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    const pending = takePendingSave()
    if (pending) {
      setNodes(pending.graphJson.nodes.map((n) => ({
        id: n.id,
        type: 'archNode',
        position: n.position ?? { x: 0, y: 0 },
        data: { componentType: n.type, label: n.label ?? n.type, config: n.config, health: 'idle' },
      })))
      setEdges(pending.graphJson.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
      setProjectName(pending.name)
      setSaveDraftName(pending.name === 'Untitled Project' ? '' : pending.name)
      setShowSaveDialog(true)
      setToast('Welcome back — pick up where you left off and save')
      return
    }

    const templateId = params.get('template')
    const loadProjectId = params.get('projectId')
    const galleryProjectId = params.get('galleryProjectId')
    const interviewPromptId = params.get('interviewPromptId')

    if (interviewPromptId) {
      setProjectName('Interview practice')
      listInterviewPrompts()
        .then((prompts) => {
          const found = prompts.find((p) => p.id === interviewPromptId)
          if (found) {
            setInterviewPrompt(found)
            setProjectName(found.title)
          } else {
            setToast("Couldn't find that interview prompt")
          }
        })
        .catch(() => setToast("Couldn't load that interview prompt"))
    }

    if (galleryProjectId) {
      setIsLoadingProject(true)
      getPublicProject(galleryProjectId)
        .then((project) => {
          // Loaded as a fresh, unowned copy — projectId stays null so Save creates a new
          // project instead of overwriting the original author's.
          setProjectName(project.name)
          setNodes(project.graphJson.nodes.map((n) => ({
            id: n.id,
            type: 'archNode',
            position: n.position ?? { x: 0, y: 0 },
            data: { componentType: n.type, label: n.label ?? n.type, config: n.config, health: 'idle' },
          })))
          setEdges(project.graphJson.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
          setIsDirty(true)
          setToast(`Loaded "${project.name}" from the gallery — save to make your own copy`)
        })
        .catch(() => setToast("Couldn't load that gallery project"))
        .finally(() => setIsLoadingProject(false))
    } else if (templateId) {
      const template = TEMPLATES.find((t) => t.id === templateId)
      if (template) {
        setNodes(template.graph.nodes.map((n) => ({
          id: n.id,
          type: 'archNode',
          position: n.position ?? { x: 0, y: 0 },
          data: { componentType: n.type, label: n.label ?? n.type, config: n.config, health: 'idle' },
        })))
        setEdges(template.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
        setProjectName(template.name)
      }
    } else if (loadProjectId) {
      setIsLoadingProject(true)
      getProject(loadProjectId)
        .then((project) => {
          setProjectId(project.id)
          setProjectName(project.name)
          setNodes(project.graphJson.nodes.map((n) => ({
            id: n.id,
            type: 'archNode',
            position: n.position ?? { x: 0, y: 0 },
            data: { componentType: n.type, label: n.label ?? n.type, config: n.config, health: 'idle' },
          })))
          setEdges(project.graphJson.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
        })
        .catch(() => setToast("Couldn't load that project"))
        .finally(() => setIsLoadingProject(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const hasClient = nodes.some((n) => n.data.componentType === 'client')
  const canRun = nodes.length > 0 && hasClient && !sim.isRunning
  const global = sim.currentTick?.global
  const estimatedMonthlyCost = estimateTotalMonthlyCost(
    nodes.map((n) => ({ type: n.data.componentType as ComponentType, replicas: replicasOf(n.data.componentType, n.data.config, n.data.replicas), config: n.data.config })),
  )
  const simulationState = sim.isRunning ? 'Starting' : sim.isPlaying ? 'Running' : sim.result ? 'Paused' : 'Ready'

  const markDirty = () => setIsDirty(true)

  const handleNodesChange = (changes: Parameters<typeof onNodesChange>[0]) => {
    if (changes.length > 0) setIsDirty(true)
    onNodesChange(changes)
  }

  const handleEdgesChange = (changes: Parameters<typeof onEdgesChange>[0]) => {
    if (changes.length > 0) setIsDirty(true)
    onEdgesChange(changes)
  }

  const handleRun = () => {
    if (sim.result) {
      sim.resume()
      return
    }
    sim.run(nodes, edges, baseRps * traffic, 3, failures)
  }

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    try {
      const result = await analyzeGraph(
        nodes.map((n) => ({ id: n.id, type: n.data.componentType, config: n.data.config })),
        edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
        sim.result?.summary ?? null,
      )
      setAnalysis(result)
    } catch {
      setAnalysis({ findings: [], aiEnabled: false })
      setToast('Analysis service is unavailable — showing local checks')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const performSave = async (name: string) => {
    setIsSaving(true)
    setSaveError(null)
    const graphJson = { nodes: toGraphNodes(nodes), edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) }
    try {
      if (projectId) {
        await updateProject(projectId, name, '', graphJson)
      } else {
        const created = await createProject(name, '', graphJson)
        setProjectId(created.id)
      }
      setProjectName(name)
      setIsDirty(false)
      setToast('Project saved')
      setShowSaveDialog(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (!auth.user) {
      const graphJson = { nodes: toGraphNodes(nodes), edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) }
      stashPendingSave(projectName, graphJson)
      navigate('/login?redirect=/app')
      return
    }
    if (projectId) {
      performSave(projectName)
    } else {
      setSaveDraftName(projectName === 'Untitled Project' ? '' : projectName)
      setShowSaveDialog(true)
    }
  }

  const applyTemplate = (templateId: string) => {
    const template = TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setNodes(template.graph.nodes.map((n) => ({
      id: n.id,
      type: 'archNode',
      position: n.position ?? { x: 0, y: 0 },
      data: { componentType: n.type, label: n.label ?? n.type, config: n.config, health: 'idle' },
    })))
    setEdges(template.graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
    setProjectName(template.name)
    setSelectedNodeId(null)
    setTemplatesOpen(false)
    setIsDirty(true)
    setToast(`${template.name} loaded`)
  }

  const toggleRealPricing = async () => {
    if (realPricingOpen) {
      setRealPricingOpen(false)
      return
    }
    setRealPricingOpen(true)
    if (isLoadingRealPricing) return
    setIsLoadingRealPricing(true)
    setRealPricingError(null)
    try {
      const nodePayload = nodes.map((n) => ({ id: n.id, type: n.data.componentType, config: n.data.config }))
      const edgePayload = edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
      const currentRps = baseRps * traffic
      const [legacyResult, multiResult, scaleResult] = await Promise.allSettled([
        estimateRealCost(nodePayload),
        compareMultiCloudCosts(nodePayload, edgePayload, currentRps, sim.result?.summary ?? null),
        getScaleTiers()
      ])
      if (scaleResult.status === 'fulfilled') {
        setScaleTiers(scaleResult.value)
      }
      if (multiResult.status === 'fulfilled') {
        setMultiCloudPricing(multiResult.value)
      }
      if (legacyResult.status === 'fulfilled') {
        setRealPricing(legacyResult.value)
      }
      if (legacyResult.status === 'rejected' && multiResult.status === 'rejected') {
        throw new Error('Pricing lookup failed')
      }
    } catch (err) {
      setRealPricingError(err instanceof Error ? err.message : 'Pricing lookup failed')
    } finally {
      setIsLoadingRealPricing(false)
    }
  }

  const openHistory = async () => {
    if (!projectId) return
    setHistoryOpen((v) => !v)
    setExportOpen(false)
    setTemplatesOpen(false)
    setMobileMenuOpen(false)
    setIsLoadingVersions(true)
    try {
      setVersions(await listVersions(projectId))
    } catch {
      setToast("Couldn't load version history")
    } finally {
      setIsLoadingVersions(false)
    }
  }

  const handleRestoreVersion = async (versionId: string) => {
    if (!projectId) return
    setRestoringVersionId(versionId)
    try {
      const restored = await restoreVersion(projectId, versionId)
      setNodes(restored.graphJson.nodes.map((n) => ({
        id: n.id,
        type: 'archNode',
        position: n.position ?? { x: 0, y: 0 },
        data: { componentType: n.type, label: n.label ?? n.type, config: n.config, health: 'idle' },
      })))
      setEdges(restored.graphJson.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
      setIsDirty(false)
      setHistoryOpen(false)
      setToast('Restored previous version')
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setRestoringVersionId(null)
    }
  }

  useEffect(() => {
    if (!projectId) {
      setComments([])
      return
    }
    listComments(projectId).then(setComments).catch(() => {})
  }, [projectId])

  const openCommentsFor = (nodeId: string) => {
    setCommentNodeId(nodeId)
    setCommentDraft('')
    setCommentsError(null)
  }

  const submitComment = async () => {
    if (!projectId || !commentNodeId || !commentDraft.trim()) return
    setIsPostingComment(true)
    setCommentsError(null)
    try {
      const created = await createComment(projectId, commentNodeId, commentDraft.trim())
      setComments((current) => [...current, created])
      setCommentDraft('')
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setIsPostingComment(false)
    }
  }

  const removeComment = async (commentId: string) => {
    if (!projectId) return
    try {
      await deleteComment(projectId, commentId)
      setComments((current) => current.filter((c) => c.id !== commentId))
    } catch {
      setToast("Couldn't delete comment")
    }
  }

  const commentCounts = comments.reduce<Record<string, number>>((acc, c) => {
    acc[c.nodeId] = (acc[c.nodeId] ?? 0) + 1
    return acc
  }, {})

  const applyImportedGraph = (result: SrsImportResult, fileName: string) => {
    setNodes(result.graphJson.nodes.map((n) => ({
      id: n.id,
      type: 'archNode',
      position: n.position,
      data: { componentType: n.type, label: n.label, config: n.config, health: 'idle' },
    })))
    setEdges(result.graphJson.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'archEdge' })))
    setProjectId(null)
    setProjectName(fileName.replace(/\.[^.]+$/, ''))
    setSelectedNodeId(null)
    setIsDirty(true)
    setAnalysis({ findings: result.findings, aiEnabled: result.aiEnabled })
    setSrsUnrecognized(result.unrecognizedTerms)
    setToast(`Generated ${result.graphJson.nodes.length} components from "${fileName}"`)
  }

  const handleSrsFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setIsImportingSrs(true)
    setSrsUnrecognized([])
    try {
      const result = await importSrs(file)
      if (nodes.length > 0) {
        setPendingSrsImport({ result, fileName: file.name })
      } else {
        applyImportedGraph(result, file.name)
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'SRS import failed')
    } finally {
      setIsImportingSrs(false)
    }
  }

  const exportJson = () => {
    downloadText('sysflow-architecture.json', JSON.stringify({ projectName, nodes: toGraphNodes(nodes), edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) }, null, 2), 'application/json')
    setExportOpen(false)
  }

  const exportPdf = () => {
    setExportOpen(false)
    setMobileMenuOpen(false)
    generateReport({
      projectName,
      nodes: nodes.map((n) => ({ id: n.id, label: n.data.label, type: n.data.componentType })),
      edges: edges.map((e) => ({ source: e.source, target: e.target })),
      findings: analysis?.findings ?? [],
      aiEnabled: analysis?.aiEnabled ?? false,
      simSummary: sim.result?.summary ?? null,
      estimatedMonthlyCost,
      realPricing,
    })
  }

  const exportDockerCompose = () => {
    const compose = generateDockerCompose(
      nodes.map((n) => ({ id: n.id, type: n.data.componentType, label: n.data.label, config: n.data.config })),
      edges.map((e) => ({ source: e.source, target: e.target })),
    )
    downloadText('docker-compose.yml', compose, 'text/yaml')
    setExportOpen(false)
  }

  const nodeTargets = nodes
  const edgeTargets = edges
  const chaosTargetOptions = chaosType === 'dropPct' ? edgeTargets : nodeTargets

  useEffect(() => {
    if (!chaosTargetOptions.some((item) => item.id === chaosTarget)) setChaosTarget(chaosTargetOptions[0]?.id ?? '')
  }, [chaosType, nodes.length, edges.length, chaosTarget])

  const injectChaos = () => {
    if (!chaosTarget) return
    let failure: InjectedFailure
    if (chaosType === 'kill') failure = { type: 'kill', nodeId: chaosTarget, fromTick: 0 }
    else if (chaosType === 'latency') failure = { type: 'latency', nodeId: chaosTarget, fromTick: 0, extraMs: Math.max(1, chaosLatency) }
    else if (chaosType === 'throttle') failure = { type: 'throttle', nodeId: chaosTarget, fromTick: 0, throttlePct: Math.max(1, Math.min(100, chaosThrottle)) }
    else failure = { type: 'dropPct', edgeId: chaosTarget, fromTick: 0, dropPct: Math.max(1, Math.min(100, chaosDrop)) }
    setFailures((current) => [...current.filter((item) => !(item.type === failure.type && (item.nodeId === failure.nodeId || item.edgeId === failure.edgeId))), failure])
    setIsDirty(true)
    setToast(`${CHAOS_TYPES.find((item) => item.type === chaosType)?.label} injected`)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        history.undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        history.redo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveClick()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setNodes((nds) => nds.map((node) => ({ ...node, selected: true })))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          e.preventDefault()
          setNodes((nds) => nds.filter((node) => node.id !== selectedNodeId))
          setEdges((eds) => eds.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId))
          setFailures((fs) => fs.filter((failure) => failure.nodeId !== selectedNodeId))
          setSelectedNodeId(null)
          setIsDirty(true)
        }
      } else if (e.key === 'Escape') {
        setExportOpen(false)
        setTemplatesOpen(false)
        setChaosOpen(false)
        setMobileMenuOpen(false)
        setHistoryOpen(false)
        setRealPricingOpen(false)
        setInterviewGrade(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, projectId, projectName, nodes, edges])

  return (
    <div className="editor-shell flex h-screen min-h-0 flex-col bg-[#f8fcfd] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      <header className="editor-header relative z-30 flex min-h-[76px] items-center justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:gap-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3 sm:min-w-[220px]">
          <Link to="/" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-zinc-800 shadow-sm sm:h-12 sm:w-12">
            <img src={logo} alt="SysFlow" className="h-9 w-9 object-contain sm:h-11 sm:w-11" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-base">SysFlow</span><span className="hidden rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-zinc-400 dark:text-zinc-500 sm:inline">Editor</span></div>
            <input
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); markDirty() }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              title="Edit project name"
              className="mt-0.5 w-24 border-0 bg-transparent p-0 text-xs text-zinc-400 dark:text-zinc-500 outline-none hover:text-zinc-600 dark:hover:text-zinc-300 focus:text-zinc-800 dark:focus:text-zinc-100 sm:w-44"
            />
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 md:flex">
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${isDirty ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400' : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" /> {isSaving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'Saved'}
          </span>
          {nodes.length > 0 && (
            <button
              onClick={toggleRealPricing}
              title="Click to view full Multi-Cloud Cost Pipeline (AWS, GCP, Azure)"
              className="flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            >
              ~${estimatedMonthlyCost.toLocaleString()}/mo <span className="text-zinc-400 dark:text-zinc-500">▾</span>
            </button>
          )}
          {isLoadingProject && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Loading project…</span>}
          {projectId && collab.collaborators.length > 0 && (
            <span title={collab.collaborators.map((c) => c.name).join(', ') + ' also viewing this project'} className="flex items-center -space-x-1.5">
              {collab.collaborators.slice(0, 4).map((c) => (
                <span key={c.clientId} className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-white" style={{ background: c.color }}>
                  {c.name.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" className="toolbar-icon" aria-label="Undo">↶</button>
          <button onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)" className="toolbar-icon" aria-label="Redo">↷</button>

          <div className="target-rps-box hidden items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 xl:flex">
            <div><p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400">Target RPS <span className="text-zinc-300 dark:text-zinc-600">ⓘ</span></p><input type="number" min={1} max={1000000} value={baseRps} onChange={(e) => { const value = Math.min(1000000, Math.max(1, Number(e.target.value) || 1)); setBaseRps(value); markDirty() }} className="w-20 border-0 bg-transparent p-0 text-sm font-bold text-zinc-900 dark:text-zinc-50 outline-none" /></div>
            <div className="flex items-end gap-1">
              {RPS_PRESETS.map((value) => <button key={value} onClick={() => { setBaseRps(value); markDirty() }} className={`rps-preset ${baseRps === value ? 'active' : ''}`}>{value >= 1000 ? `${value / 1000}K` : value}</button>)}
            </div>
          </div>

          <div className="relative hidden md:block">
            <button onClick={() => { setExportOpen((v) => !v); setTemplatesOpen(false); setHistoryOpen(false) }} className="toolbar-button">Export⌄</button>
            {exportOpen && <div className="popover-menu right-0 top-12">
              <button onClick={() => { setExportRequest((v) => v + 1); setExportOpen(false) }}>PNG image</button>
              <button onClick={() => { setBrandedExportRequest((v) => v + 1); setExportOpen(false) }}>Branded PNG (for sharing)</button>
              <button onClick={exportJson}>JSON graph</button>
              <button onClick={exportDockerCompose}>docker-compose.yml</button>
              <button onClick={exportPdf}>PDF report</button>
            </div>}
          </div>

          <button onClick={() => { if (!projectId) { setToast('Save the project first to get a share link'); return }; navigator.clipboard.writeText(`${window.location.origin}/share/${projectId}`); setToast('Share link copied') }} className="toolbar-button hidden md:block">Share ↗</button>

          {projectId && <button onClick={openHistory} className="toolbar-button hidden md:block">History</button>}

          <input ref={srsFileInputRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={handleSrsFileSelected} />
          <button onClick={() => srsFileInputRef.current?.click()} disabled={isImportingSrs} className="toolbar-button hidden md:block disabled:opacity-50">{isImportingSrs ? 'Importing…' : 'Import SRS'}</button>

          <div className="relative">
            <button onClick={() => { setTemplatesOpen((v) => !v); setExportOpen(false); setHistoryOpen(false) }} className="toolbar-button hidden md:block">Templates</button>
            {templatesOpen && <div className="popover-menu right-0 top-12 w-64">
              <p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Start with a template</p>
              {TEMPLATES.map((template) => <button key={template.id} onClick={() => applyTemplate(template.id)}><span className="block font-semibold text-zinc-800 dark:text-zinc-100">{template.name}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-500">{template.description}</span></button>)}
            </div>}
          </div>

          <ThemeToggle className="hidden md:inline-flex" />

          {auth.user ? <Link to="/projects" className="toolbar-button hidden lg:block">Projects</Link> : <Link to="/login" className="toolbar-button hidden lg:block">Log in</Link>}
          <button onClick={handleSaveClick} disabled={isSaving} title="Save (Ctrl+S)" className="btn-dark rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{isSaving ? 'Saving…' : 'Save'}</button>

          <div className="relative lg:hidden">
            <button onClick={() => setMobileMenuOpen((v) => !v)} className="toolbar-icon" aria-label="More options">⋯</button>
            {mobileMenuOpen && <div className="popover-menu right-0 top-12 w-56 max-h-[70vh] overflow-y-auto">
              <p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Export</p>
              <button onClick={() => { setExportRequest((v) => v + 1); setMobileMenuOpen(false) }}>PNG image</button>
              <button onClick={() => { setBrandedExportRequest((v) => v + 1); setMobileMenuOpen(false) }}>Branded PNG (for sharing)</button>
              <button onClick={() => { exportJson(); setMobileMenuOpen(false) }}>JSON graph</button>
              <button onClick={() => { exportDockerCompose(); setMobileMenuOpen(false) }}>docker-compose.yml</button>
              <button onClick={exportPdf}>PDF report</button>
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              <button onClick={() => { srsFileInputRef.current?.click(); setMobileMenuOpen(false) }} disabled={isImportingSrs}>{isImportingSrs ? 'Importing…' : 'Import SRS'}</button>
              {projectId && <button onClick={() => { openHistory(); setMobileMenuOpen(false) }}>History</button>}
              {nodes.length > 0 && <button onClick={() => { setMobileMenuOpen(false); toggleRealPricing() }}>Cost estimate (~${estimatedMonthlyCost.toLocaleString()}/mo)</button>}
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              <p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Templates</p>
              {TEMPLATES.map((template) => <button key={template.id} onClick={() => { applyTemplate(template.id); setMobileMenuOpen(false) }}><span className="block font-semibold text-zinc-800 dark:text-zinc-100">{template.name}</span></button>)}
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              <button onClick={() => { if (!projectId) { setToast('Save the project first to get a share link'); setMobileMenuOpen(false); return }; navigator.clipboard.writeText(`${window.location.origin}/share/${projectId}`); setToast('Share link copied'); setMobileMenuOpen(false) }}>Share ↗</button>
              {auth.user ? <Link to="/projects" onClick={() => setMobileMenuOpen(false)}>Projects</Link> : <Link to="/login" onClick={() => setMobileMenuOpen(false)}>Log in</Link>}
              <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
              <div className="flex items-center justify-between px-3 py-1"><span className="text-xs text-zinc-500 dark:text-zinc-400">Appearance</span><ThemeToggle /></div>
            </div>}
          </div>
        </div>
      </header>

      {srsUnrecognized.length > 0 && (
        <div className="relative z-20 flex items-center justify-between gap-3 border-b border-amber-100 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400 sm:px-6">
          <span>Couldn't confidently map: <b>{srsUnrecognized.join(', ')}</b> — placed as a generic Service. Review before running.</span>
          <button onClick={() => setSrsUnrecognized([])} className="shrink-0 text-amber-500 hover:text-amber-800 dark:hover:text-amber-300">✕</button>
        </div>
      )}

      {interviewPrompt && (
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/40 px-4 py-2 text-xs text-violet-800 dark:text-violet-300 sm:px-6">
          <div className="min-w-0">
            <span className="font-semibold">{interviewPrompt.title}</span>
            <span className="ml-2 text-violet-500 dark:text-violet-400">{interviewPrompt.brief}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={async () => {
                setIsGrading(true)
                setGradingError(null)
                try {
                  const grade = await gradeInterview(
                    interviewPrompt.id,
                    nodes.map((n) => ({ id: n.id, type: n.data.componentType, config: n.data.config })),
                    edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
                  )
                  setInterviewGrade(grade)
                } catch (err) {
                  setGradingError(err instanceof Error ? err.message : 'Grading failed')
                } finally {
                  setIsGrading(false)
                }
              }}
              disabled={nodes.length === 0 || isGrading}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {isGrading ? 'Grading…' : 'Submit for grading'}
            </button>
            <button onClick={() => setInterviewPrompt(null)} className="text-violet-400 hover:text-violet-700 dark:hover:text-violet-200">✕</button>
          </div>
        </div>
      )}
      {gradingError && (
        <div className="relative z-20 border-b border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-1.5 text-xs text-red-600 dark:text-red-400 sm:px-6">{gradingError}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {isLoadingProject && <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 dark:bg-zinc-950/60 backdrop-blur-sm"><div className="rounded-full bg-white dark:bg-zinc-800 px-4 py-2 text-sm text-zinc-500 dark:text-zinc-400 shadow-lg">Loading project…</div></div>}
        <Canvas
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          currentTick={sim.currentTick}
          isPlaying={sim.isPlaying}
          failures={failures}
          setFailures={setFailures}
          focusRequest={focusRequest}
          exportRequest={exportRequest}
          brandedExportRequest={brandedExportRequest}
          projectName={projectName}
          estimatedMonthlyCost={estimatedMonthlyCost}
          onSelectionChange={setSelectedNodeId}
          onDirty={markDirty}
          hideSidebar={!!analysis}
          onCompareNode={setCompareNodeId}
          remoteCursors={collab.remoteCursors}
          onCursorMove={collab.broadcastCursor}
          onCommentNode={projectId ? openCommentsFor : undefined}
          commentCounts={commentCounts}
          onLoadSample={() => applyTemplate('basic-3-tier')}
          onBrowseTemplates={() => setTemplatesOpen(true)}
          onImportSrs={() => srsFileInputRef.current?.click()}
        />
        {analysis && <FindingsPanel findings={analysis.findings} aiEnabled={analysis.aiEnabled} summary={sim.result?.summary} onFocusNode={(nodeId) => setFocusRequest({ nodeId, token: Date.now() })} onClose={() => setAnalysis(null)} />}
      </div>

      {interviewGrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 dark:bg-black/50 p-4 backdrop-blur-sm" onClick={() => setInterviewGrade(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-violet-500 dark:text-violet-400">Grading result</p>
                <h3 className="mt-0.5 text-2xl font-bold text-zinc-900 dark:text-zinc-50">{interviewGrade.overallScore}<span className="text-sm font-medium text-zinc-400 dark:text-zinc-500">/100</span></h3>
              </div>
              <button onClick={() => setInterviewGrade(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
            </div>
            {!interviewGrade.aiEnabled && (
              <p className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">Rule-based estimate only — AI grading wasn't available for this run.</p>
            )}
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{interviewGrade.summary}</p>

            <div className="mt-4 space-y-2">
              {interviewGrade.categories.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">{c.name}</span>
                    <span className="text-zinc-500 dark:text-zinc-400">{c.score}/{c.maxScore}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-violet-500" style={{ width: `${(c.score / c.maxScore) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{c.feedback}</p>
                </div>
              ))}
            </div>

            {interviewGrade.improvements.length > 0 && (
              <div className="mt-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Next steps</p>
                <ul className="mt-1.5 space-y-1">
                  {interviewGrade.improvements.map((imp) => (
                    <li key={imp} className="text-xs text-zinc-600 dark:text-zinc-400">· {imp}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {realPricingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 dark:bg-black/50 p-4 backdrop-blur-sm" onClick={() => setRealPricingOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Multi-Cloud Cost Pipeline</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">AWS vs GCP vs Azure end-to-end pricing</p>
              </div>
              <button onClick={() => setRealPricingOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-lg">✕</button>
            </div>

            {isLoadingRealPricing && <p className="mt-6 text-sm text-zinc-400 dark:text-zinc-500 text-center py-8">Calculating multi-cloud pipeline pricing…</p>}
            {realPricingError && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{realPricingError} — showing illustrative only.</p>}

            {!isLoadingRealPricing && multiCloudPricing && (
              <div className="mt-4 space-y-4 overflow-y-auto pr-1">
                {/* Mode & Tab Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5 text-xs font-medium">
                    {(['all', 'aws', 'gcp', 'azure', 'scale'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setPricingTab(tab)}
                        className={`rounded-md px-3 py-1.5 transition ${
                          pricingTab === tab
                            ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm'
                            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                        }`}
                      >
                        {tab === 'all' ? 'All (Compare)' : tab === 'scale' ? 'Scale Tiers' : tab.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-zinc-400">View:</span>
                    <button
                      onClick={() => setPricingCostMode(pricingCostMode === 'endToEnd' ? 'provisioned' : 'endToEnd')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition ${
                        pricingCostMode === 'endToEnd'
                          ? 'border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {pricingCostMode === 'endToEnd' ? '⚡ End-to-End (Traffic & Egress)' : '📦 Provisioned Base Only'}
                    </button>
                  </div>
                </div>

                {/* Compare All View */}
                {pricingTab === 'all' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {(['aws', 'gcp', 'azure'] as const).map((pid) => {
                        const p = multiCloudPricing.providers[pid]
                        if (!p) return null
                        const isBest = multiCloudPricing.bestValueProvider === pid
                        const displayCost = pricingCostMode === 'endToEnd' ? p.totalMonthlyCostUsd : p.provisionedCostUsd
                        return (
                          <div
                            key={pid}
                            onClick={() => setPricingTab(pid)}
                            className={`cursor-pointer rounded-xl border p-3.5 transition hover:border-indigo-400 dark:hover:border-indigo-500 ${
                              isBest
                                ? 'border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/20'
                                : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 uppercase tracking-wide">
                                {p.providerName}
                              </span>
                              {isBest && (
                                <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 uppercase">
                                  Best Value
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-xl font-bold text-zinc-900 dark:text-zinc-50">
                              ${displayCost.toFixed(2)}
                              <span className="text-xs font-normal text-zinc-400 dark:text-zinc-500">/mo</span>
                            </p>
                            <p className="mt-0.5 text-[11px] text-zinc-400">{p.region}</p>

                            <div className="mt-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80 space-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                              <div className="flex justify-between">
                                <span>Provisioned:</span>
                                <span className="font-medium text-zinc-700 dark:text-zinc-300">${p.provisionedCostUsd.toFixed(2)}</span>
                              </div>
                              {pricingCostMode === 'endToEnd' && (
                                <>
                                  <div className="flex justify-between">
                                    <span>Requests:</span>
                                    <span className="font-medium text-zinc-700 dark:text-zinc-300">${p.dynamicCostUsd.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Egress ({multiCloudPricing.dynamicMetrics.monthlyEgressGb.toFixed(0)} GB):</span>
                                    <span className="font-medium text-zinc-700 dark:text-zinc-300">${p.egressCostUsd.toFixed(2)}</span>
                                  </div>
                                  {p.cacheSavingsUsd > 0 && (
                                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                                      <span>Cache Savings:</span>
                                      <span className="font-medium">-${p.cacheSavingsUsd.toFixed(2)}</span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Operational Metrics & Recommendations */}
                    <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/40 p-3 text-xs space-y-1.5 border border-zinc-100 dark:border-zinc-800">
                      <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-300 font-medium">
                        <span>Simulated Monthly Volume:</span>
                        <span>
                          {multiCloudPricing.dynamicMetrics.simulatedRps} RPS · {multiCloudPricing.dynamicMetrics.monthlyRequestsMillions.toFixed(1)}M reqs/mo · {multiCloudPricing.dynamicMetrics.monthlyEgressGb.toFixed(1)} GB
                        </span>
                      </div>
                      {multiCloudPricing.dynamicMetrics.cacheHitRatePct > 0 && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          🛡️ CDN active with {multiCloudPricing.dynamicMetrics.cacheHitRatePct}% hit rate reducing backend traffic and egress fees.
                        </p>
                      )}
                      {multiCloudPricing.recommendations.map((rec, i) => (
                        <p key={i} className="text-[11px] text-zinc-500 dark:text-zinc-400">💡 {rec}</p>
                      ))}
                    </div>
                  </>
                )}

                  {/* Scale Tiers Matrix */}
                  {pricingTab === 'scale' && scaleTiers && (
                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                      {['compute', 'database', 'cache'].map((cat) => (
                        <div key={cat} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                          <div className="bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
                            <h3 className="font-semibold text-xs text-zinc-800 dark:text-zinc-200 uppercase tracking-wide">{cat}</h3>
                          </div>
                          <table className="w-full text-xs text-left">
                            <thead className="bg-zinc-50/50 dark:bg-zinc-800/20 text-zinc-500">
                              <tr>
                                <th className="px-3 py-2 font-medium">Tier</th>
                                {Object.values(scaleTiers.providers).map(p => (
                                  <th key={p.providerId} className="px-3 py-2 font-medium">{p.providerName}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {Object.keys(scaleTiers.providers['aws']?.categories[cat]?.tiers || {}).map((tierName) => (
                                <tr key={tierName} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                                  <td className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{tierName}</td>
                                  {Object.values(scaleTiers.providers).map(p => {
                                    const tp = p.categories[cat]?.tiers[tierName]
                                    if (!tp) return <td key={p.providerId} className="px-3 py-2">-</td>
                                    return (
                                      <td key={p.providerId} className="px-3 py-2" title={tp.description}>
                                        <div className="flex flex-col">
                                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">${tp.monthlyUsd.toFixed(2)}<span className="text-[9px] text-zinc-400 font-normal">/mo</span></span>
                                          <span className="text-[10px] text-zinc-500 font-mono mt-0.5">{tp.skuName}</span>
                                        </div>
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Single Provider Details */}
                  {pricingTab !== 'all' && pricingTab !== 'scale' && multiCloudPricing.providers[pricingTab] && (() => {
                  const p = multiCloudPricing.providers[pricingTab]
                  return (
                    <div className="space-y-3">
                      <div className="flex items-baseline justify-between rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3 border border-zinc-100 dark:border-zinc-800">
                        <div>
                          <p className="text-xs text-zinc-400">{p.providerName} · {p.region}</p>
                          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                            ${(pricingCostMode === 'endToEnd' ? p.totalMonthlyCostUsd : p.provisionedCostUsd).toFixed(2)}
                            <span className="text-sm font-normal text-zinc-400">/mo</span>
                          </p>
                        </div>
                        <div className="text-right text-xs space-y-0.5 text-zinc-500">
                          <p>Instances: <span className="font-semibold text-zinc-700 dark:text-zinc-200">${p.provisionedCostUsd.toFixed(2)}</span></p>
                          {pricingCostMode === 'endToEnd' && (
                            <>
                              <p>Traffic/Requests: <span className="font-semibold text-zinc-700 dark:text-zinc-200">${p.dynamicCostUsd.toFixed(2)}</span></p>
                              <p>Egress: <span className="font-semibold text-zinc-700 dark:text-zinc-200">${p.egressCostUsd.toFixed(2)}</span></p>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-zinc-100 dark:border-zinc-800 p-1">
                        {p.nodes.map((n) => (
                          <div key={n.id} className="rounded-lg px-2.5 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                            <div className="flex items-center justify-between text-xs">
                              <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">{n.id}</span>
                              <span className="flex items-center gap-1.5 shrink-0">
                                <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase ${n.source === 'real' ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`}>
                                  {n.source}
                                </span>
                                <span className="font-semibold text-zinc-800 dark:text-zinc-200">${n.monthlyCostUsd.toFixed(2)}</span>
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">{n.note}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {!isLoadingRealPricing && !multiCloudPricing && realPricing && (
              <div className="mt-3">
                <p className="text-xl font-bold text-zinc-900 dark:text-zinc-50">${realPricing.totalMonthlyCostUsd.toFixed(2)}<span className="text-sm font-medium text-zinc-400">/mo</span></p>
                <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-zinc-100 dark:border-zinc-800 p-1">
                  {realPricing.nodes.map((n) => (
                    <div key={n.id} className="rounded-lg px-2.5 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate text-zinc-600 dark:text-zinc-300">{n.id}</span>
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">${n.monthlyCostUsd.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 dark:bg-black/50 p-4 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Version history</h3>
              <button onClick={() => setHistoryOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
            </div>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Every save keeps the last 10 versions. Restoring one is itself undoable.</p>
            <div className="mt-4 max-h-72 space-y-1 overflow-y-auto">
              {isLoadingVersions && <p className="py-2 text-xs text-zinc-400 dark:text-zinc-500">Loading…</p>}
              {!isLoadingVersions && versions.length === 0 && <p className="py-2 text-xs text-zinc-400 dark:text-zinc-500">No previous versions yet — saves create one automatically.</p>}
              {!isLoadingVersions && versions.map((v) => (
                <button key={v.id} onClick={() => handleRestoreVersion(v.id)} disabled={restoringVersionId === v.id} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
                  <span className="text-zinc-700 dark:text-zinc-300">{new Date(v.createdAt).toLocaleString()}</span>
                  <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-400">{restoringVersionId === v.id ? 'Restoring…' : 'Restore'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {commentNodeId && (() => {
        const targetNode = nodes.find((n) => n.id === commentNodeId)
        const threadComments = comments.filter((c) => c.nodeId === commentNodeId)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 dark:bg-black/50 p-4 backdrop-blur-sm" onClick={() => setCommentNodeId(null)}>
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Comments</h3>
                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{targetNode?.data.label ?? commentNodeId}</p>
                </div>
                <button onClick={() => setCommentNodeId(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">✕</button>
              </div>

              <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
                {threadComments.length === 0 && <p className="py-2 text-xs text-zinc-400 dark:text-zinc-500">No comments yet — leave a note for later, or for anyone reviewing this design.</p>}
                {threadComments.map((c) => (
                  <div key={c.id} className="group rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{c.authorName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{new Date(c.createdAt).toLocaleString()}</span>
                        <button onClick={() => removeComment(c.id)} className="text-[10px] text-red-400 opacity-0 hover:text-red-600 dark:hover:text-red-400 group-hover:opacity-100">Delete</button>
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{c.text}</p>
                  </div>
                ))}
              </div>

              {commentsError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{commentsError}</p>}

              <div className="mt-4 flex gap-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Add a comment…"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitComment()}
                  className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 outline-none focus:border-violet-400 focus:bg-white dark:focus:bg-zinc-900 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40"
                />
                <button onClick={submitComment} disabled={!commentDraft.trim() || isPostingComment} className="btn-dark rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50">
                  {isPostingComment ? '…' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {pendingSrsImport && (
        <SrsDiffModal
          currentNodes={nodes}
          currentEdges={edges}
          imported={pendingSrsImport.result}
          fileName={pendingSrsImport.fileName}
          onCancel={() => setPendingSrsImport(null)}
          onConfirm={() => {
            applyImportedGraph(pendingSrsImport.result, pendingSrsImport.fileName)
            setPendingSrsImport(null)
          }}
        />
      )}

      {compareNodeId && (() => {
        const compareTarget = nodes.find((n) => n.id === compareNodeId)
        if (!compareTarget) return null
        return (
          <CompareModal
            node={compareTarget}
            nodes={nodes}
            edges={edges}
            targetRps={baseRps * traffic}
            failures={failures}
            onClose={() => setCompareNodeId(null)}
            onApply={(newType) => {
              const def = COMPONENT_LIBRARY.find((c) => c.type === newType)
              setNodes((nds) => nds.map((n) =>
                n.id === compareNodeId
                  ? { ...n, data: { ...n.data, componentType: newType, label: def?.label ?? newType, config: { ...(def?.defaultConfig ?? {}) }, replicas: undefined, metrics: undefined, hasFailure: false, health: 'idle' } }
                  : n,
              ))
              setIsDirty(true)
              setCompareNodeId(null)
              setToast(`Swapped to ${def?.label ?? newType}`)
            }}
          />
        )
      })()}

      <footer className="simulation-footer relative z-30 overflow-x-hidden border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.04)] sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <button onClick={handleRun} disabled={!canRun} className="run-button"><span>{sim.isPlaying ? '▶' : '▶'}</span> {sim.isPlaying ? 'Running' : sim.result ? 'Resume' : sim.isRunning ? 'Starting…' : 'Run'}<small>Ctrl + Enter</small></button>
            {sim.isPlaying && <button onClick={sim.pause} className="simulation-secondary">Pause</button>}
            {sim.result && <button onClick={sim.reset} className="simulation-secondary danger">Stop</button>}
          </div>

          <div className="simulation-state"><span className={`state-dot ${simulationState.toLowerCase()}`} /> Simulation: <b>{simulationState}</b></div>

          <div className="segmented-group"><span>Speed</span>{SPEED_OPTIONS.map((value) => <button key={value} onClick={() => sim.setSpeed(value)} className={sim.speed === value ? 'active' : ''}>{value}×</button>)}</div>
          <div className="segmented-group"><span>Traffic</span>{TRAFFIC_OPTIONS.map((value) => <button key={value} onClick={() => { setTraffic(value); markDirty() }} className={traffic === value ? 'active' : ''}>{value}×</button>)}</div>

          <div className="relative">
            <button onClick={() => setChaosOpen((v) => !v)} className={`chaos-button ${failures.length > 0 ? 'active' : ''}`}>⚡ Chaos {failures.length > 0 && <b>{failures.length}</b>}</button>
            {chaosOpen && <div className="chaos-popover">
              <div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Chaos engineering</p><p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-50">Inject a controlled failure</p></div><button onClick={() => setChaosOpen(false)} className="text-zinc-400 dark:text-zinc-500">✕</button></div>
              <div className="mt-3 grid grid-cols-2 gap-1.5">{CHAOS_TYPES.map(({ type, label, Icon }) => <button key={type} onClick={() => setChaosType(type)} className={`chaos-option ${chaosType === type ? 'active' : ''}`}><Icon width={14} height={14} />{label}</button>)}</div>
              <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{chaosType === 'dropPct' ? 'Select edge' : 'Select node'}
                <select value={chaosTarget} onChange={(e) => setChaosTarget(e.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-xs text-zinc-700 dark:text-zinc-200 outline-none focus:border-violet-400">
                  {chaosTargetOptions.length === 0 && <option value="">No targets available</option>}
                  {chaosTargetOptions.map((item) => <option key={item.id} value={item.id}>{chaosType === 'dropPct' && 'source' in item ? `${item.source} → ${item.target}` : nodes.find((n) => n.id === item.id)?.data.label}</option>)}
                </select>
              </label>
              {chaosType === 'latency' && <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Latency (ms)<input type="number" min={1} value={chaosLatency} onChange={(e) => setChaosLatency(Number(e.target.value))} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-xs text-zinc-800 dark:text-zinc-100" /></label>}
              {chaosType === 'dropPct' && <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Drop packets (%)<input type="number" min={1} max={100} value={chaosDrop} onChange={(e) => setChaosDrop(Number(e.target.value))} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-xs text-zinc-800 dark:text-zinc-100" /></label>}
              {chaosType === 'throttle' && <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Reduce capacity (%)<input type="number" min={1} max={100} value={chaosThrottle} onChange={(e) => setChaosThrottle(Number(e.target.value))} className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-2 text-xs text-zinc-800 dark:text-zinc-100" /></label>}
              <button onClick={injectChaos} disabled={!chaosTarget} className="mt-3 w-full rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-2 text-xs font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40">Inject Failure</button>
              {failures.length > 0 && <button onClick={() => { setFailures([]); setIsDirty(true) }} className="mt-2 w-full text-[10px] font-semibold text-red-500 dark:text-red-400">Clear all failures</button>}
            </div>}
          </div>

          <div className="live-metrics ml-auto flex min-w-[380px] items-center gap-5 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/40 px-4 py-2">
            <div><span>RPS</span><b>{Math.round(global?.rps ?? 0).toLocaleString()}</b></div>
            <div><span>p95 latency</span><b>{Math.round(global?.p95 ?? 0)}ms</b></div>
            <div><span>Error rate</span><b className={(global?.errorRatePct ?? 0) >= 5 ? 'bad' : ''}>{(global?.errorRatePct ?? 0).toFixed(1)}%</b></div>
            <div><span>Throughput</span><b>{((global?.rps ?? 0) / 100).toFixed(1)} MB/s</b></div>
            {nodes.length > 0 && (
              <button
                onClick={toggleRealPricing}
                title="Click to open Multi-Cloud Cost Pipeline (AWS, GCP, Azure)"
                className="flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/40 px-2.5 py-1 text-left transition hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
              >
                <div>
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Cloud Cost ▾</span>
                  <b className="text-xs font-bold text-emerald-700 dark:text-emerald-300">~${estimatedMonthlyCost.toLocaleString()}/mo</b>
                </div>
              </button>
            )}
          </div>

          <button onClick={handleAnalyze} disabled={nodes.length === 0 || isAnalyzing} className="analyze-button">✨ <span>{isAnalyzing ? 'Analyzing…' : 'Analyze'}</span><small>AI Analysis</small></button>
        </div>
        {sim.error && <p className="mt-1 text-xs text-red-500 dark:text-red-400">{sim.error}</p>}
      </footer>

      <div className="shortcut-strip hidden items-center justify-center gap-5 border-t border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-1.5 text-[9px] text-zinc-400 dark:text-zinc-500 lg:flex">
        <span><kbd>Delete</kbd> Delete node</span><span><kbd>Ctrl + Z</kbd> Undo</span><span><kbd>Ctrl + Y</kbd> Redo</span><span><kbd>Ctrl + S</kbd> Save</span><span><kbd>Ctrl + A</kbd> Select all</span><span><kbd>Drag</kbd> Pan · <kbd>Scroll</kbd> Pan · <kbd>Ctrl + Scroll</kbd> Zoom</span><span><kbd>Esc</kbd> Cancel connection</span>
      </div>

      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/20 dark:bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowSaveDialog(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Save project</h3>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Give this architecture a name so you can return to it later.</p>
            <input autoFocus type="text" placeholder="Project name" value={saveDraftName} onChange={(e) => setSaveDraftName(e.target.value)} className="mt-4 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-800 dark:text-zinc-100 outline-none focus:border-violet-400 focus:bg-white dark:focus:bg-zinc-900 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40" />
            {saveError && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{saveError}</p>}
            <div className="mt-4 flex justify-end gap-2"><button onClick={() => setShowSaveDialog(false)} className="rounded-xl px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">Cancel</button><button onClick={() => saveDraftName.trim() && performSave(saveDraftName.trim())} disabled={!saveDraftName.trim() || isSaving} className="btn-dark rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50">{isSaving ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 dark:bg-zinc-100 px-4 py-2 text-xs font-medium text-white dark:text-zinc-900 shadow-xl">{toast}</div>}
    </div>
  )
}