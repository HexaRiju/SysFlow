export type ComponentType =
  | 'client'
  | 'mobile'
  | 'webBrowser'
  | 'iotDevice'
  | 'dns'
  | 'cdn'
  | 'loadBalancer'
  | 'apiGateway'
  | 'waf'
  | 'ingress'
  | 'service'
  | 'worker'
  | 'serverless'
  | 'queue'
  | 'autoScalingGroup'
  | 'containerOrchestrator'
  | 'cronJob'
  | 'cache'
  | 'database'
  | 'dataWarehouse'
  | 'objectStorage'
  | 'searchIndex'
  | 'dataLake'
  | 'messageBroker'
  | 'eventBus'
  | 'webhook'
  | 'monitoring'
  | 'logging'
  | 'thirdPartyApi'
  | 'paymentGateway'

export type ComponentCategory = 'Client' | 'Traffic & Edge' | 'Compute' | 'Data' | 'Messaging' | 'Observability' | 'External'

export interface ComponentDef {
  type: ComponentType
  label: string
  category: ComponentCategory
  defaultConfig: Record<string, unknown>
}

export const COMPONENT_LIBRARY: ComponentDef[] = [
  // Client
  { type: 'client', label: 'Client', category: 'Client', defaultConfig: { targetRps: 100 } },
  { type: 'mobile', label: 'Mobile', category: 'Client', defaultConfig: { targetRps: 100 } },
  { type: 'webBrowser', label: 'Web Browser', category: 'Client', defaultConfig: { targetRps: 100 } },
  { type: 'iotDevice', label: 'IoT Device', category: 'Client', defaultConfig: { targetRps: 20 } },

  // Traffic & Edge
  { type: 'dns', label: 'DNS', category: 'Traffic & Edge', defaultConfig: { resolutionLatencyMs: 5 } },
  { type: 'cdn', label: 'CDN', category: 'Traffic & Edge', defaultConfig: { hitRatePct: 90, hitLatencyMs: 3, missLatencyMs: 35 } },
  {
    type: 'loadBalancer',
    label: 'Load Balancer',
    category: 'Traffic & Edge',
    defaultConfig: { algorithm: 'round-robin', maxThroughput: 1000 },
  },
  { type: 'apiGateway', label: 'API Gateway', category: 'Traffic & Edge', defaultConfig: { rateLimit: 500 } },
  { type: 'waf', label: 'WAF', category: 'Traffic & Edge', defaultConfig: { maxThroughput: 2000, extraLatencyMs: 2 } },
  { type: 'ingress', label: 'Ingress', category: 'Traffic & Edge', defaultConfig: { maxThroughput: 1500 } },

  // Compute
  {
    type: 'service',
    label: 'Service',
    category: 'Compute',
    defaultConfig: { scale: 'Auto', minLatencyMs: 20, maxLatencyMs: 80, maxConcurrency: 500, failureRateAtSaturation: 5 },
  },
  {
    type: 'worker',
    label: 'Worker',
    category: 'Compute',
    defaultConfig: { scale: 'Auto', minLatencyMs: 30, maxLatencyMs: 150, maxConcurrency: 300, failureRateAtSaturation: 5 },
  },
  {
    type: 'serverless',
    label: 'Serverless',
    category: 'Compute',
    defaultConfig: { scale: 'Auto', minLatencyMs: 40, maxLatencyMs: 300, maxConcurrency: 1000, failureRateAtSaturation: 3 },
  },
  { type: 'queue', label: 'Message Queue', category: 'Compute', defaultConfig: { maxThroughput: 1000, consumers: 1 } },
  {
    type: 'autoScalingGroup',
    label: 'Auto-Scaling Group',
    category: 'Compute',
    defaultConfig: { scale: 'Auto', minReplicas: 1, maxReplicas: 10, targetLoadPct: 70, baseCapacityPerReplica: 500, minLatencyMs: 20, maxLatencyMs: 80 },
  },
  {
    type: 'containerOrchestrator',
    label: 'Container Orchestrator',
    category: 'Compute',
    defaultConfig: { scale: 'Auto', minReplicas: 2, maxReplicas: 20, targetLoadPct: 70, baseCapacityPerReplica: 600, minLatencyMs: 15, maxLatencyMs: 70 },
  },
  {
    type: 'cronJob',
    label: 'Cron Job',
    category: 'Compute',
    defaultConfig: { scale: 'Auto', minLatencyMs: 50, maxLatencyMs: 400, maxConcurrency: 50, failureRateAtSaturation: 5 },
  },

  // Data
  {
    type: 'cache',
    label: 'Cache',
    category: 'Data',
    defaultConfig: { scale: 'Auto', hitRatePct: 80, hitLatencyMs: 2, missLatencyMs: 40 },
  },
  {
    type: 'database',
    label: 'Database',
    category: 'Data',
    defaultConfig: { scale: 'Auto', readLatencyMs: 15, writeLatencyMs: 30, maxConnections: 200, replicaCount: 0 },
  },
  {
    type: 'dataWarehouse',
    label: 'Data Warehouse',
    category: 'Data',
    defaultConfig: { scale: 'Auto', readLatencyMs: 60, writeLatencyMs: 100, maxConnections: 100, replicaCount: 0 },
  },
  {
    type: 'objectStorage',
    label: 'Object Storage',
    category: 'Data',
    defaultConfig: { readLatencyMs: 25, writeLatencyMs: 50, maxThroughput: 3000 },
  },
  {
    type: 'searchIndex',
    label: 'Search Index',
    category: 'Data',
    defaultConfig: { readLatencyMs: 20, writeLatencyMs: 40, maxConnections: 300, replicaCount: 0 },
  },
  {
    type: 'dataLake',
    label: 'Data Lake',
    category: 'Data',
    defaultConfig: { readLatencyMs: 80, writeLatencyMs: 120, maxConnections: 100 },
  },

  // Messaging
  { type: 'messageBroker', label: 'Message Broker', category: 'Messaging', defaultConfig: { maxThroughput: 2000, consumers: 3 } },
  { type: 'eventBus', label: 'Event Bus', category: 'Messaging', defaultConfig: { maxThroughput: 3000 } },
  { type: 'webhook', label: 'Webhook', category: 'Messaging', defaultConfig: { maxThroughput: 300, extraLatencyMs: 20 } },

  // Observability
  { type: 'monitoring', label: 'Monitoring', category: 'Observability', defaultConfig: { maxThroughput: 5000 } },
  { type: 'logging', label: 'Logging', category: 'Observability', defaultConfig: { maxThroughput: 5000 } },

  // External
  { type: 'thirdPartyApi', label: 'Third-Party API', category: 'External', defaultConfig: { maxThroughput: 200, minLatencyMs: 50, maxLatencyMs: 400 } },
  { type: 'paymentGateway', label: 'Payment Gateway', category: 'External', defaultConfig: { maxThroughput: 150, minLatencyMs: 100, maxLatencyMs: 600 } },
]

export const COMPONENT_CATEGORIES: ComponentCategory[] = ['Client', 'Traffic & Edge', 'Compute', 'Data', 'Messaging', 'Observability', 'External']

export type HealthState = 'idle' | 'healthy' | 'underLoad' | 'critical' | 'down'

export const HEALTH_COLORS: Record<HealthState, string> = {
  idle: '#6b7280',
  healthy: '#22c55e',
  underLoad: '#f59e0b',
  critical: '#f97316',
  down: '#ef4444',
}

export function deriveHealth(loadPct: number, errorRatePct: number, down: boolean): HealthState {
  if (down) return 'down'
  if (loadPct > 85 || errorRatePct >= 5) return 'critical'
  if (loadPct >= 60 || errorRatePct >= 1) return 'underLoad'
  return 'healthy'
}
