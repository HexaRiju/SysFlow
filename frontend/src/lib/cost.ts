import type { ComponentType } from '../components/nodes'

/** Rough, illustrative monthly USD cost per instance — not a real cloud pricing model, just enough to make tradeoffs visible. */
export const MONTHLY_COST_USD: Record<ComponentType, number> = {
  client: 0,
  mobile: 0,
  webBrowser: 0,
  dns: 1,
  cdn: 20,
  loadBalancer: 18,
  apiGateway: 15,
  waf: 12,
  ingress: 10,
  service: 25,
  worker: 20,
  serverless: 5,
  cache: 15,
  database: 60,
  dataWarehouse: 220,
  queue: 10,
  autoScalingGroup: 25, // × replicas, computed dynamically
  iotDevice: 0,
  containerOrchestrator: 70,
  cronJob: 5,
  objectStorage: 15,
  searchIndex: 45,
  dataLake: 180,
  messageBroker: 30,
  eventBus: 20,
  webhook: 5,
  monitoring: 25,
  logging: 25,
  thirdPartyApi: 0,
  paymentGateway: 0,
}

/** Mirrors backend CostModel.monthlyCostOf's replica/scaling-config handling. */
export function replicasOf(componentType: string, config: Record<string, unknown> | undefined, liveReplicas?: number): number {
  if (componentType === 'autoScalingGroup' || componentType === 'containerOrchestrator') {
    return liveReplicas ?? Number(config?.minReplicas ?? 1)
  }
  if (componentType === 'database' || componentType === 'searchIndex' || componentType === 'dataWarehouse') {
    return 1 + Number(config?.replicaCount ?? 0)
  }
  return 1
}

const SCALE_MULTIPLIERS: Record<string, number> = {
  'XS_2GB': 0.25,
  'SM_4GB': 0.5,
  'MD_8GB': 1.0,
  'LG_16GB': 2.0,
  'XL_32GB': 4.0,
}

export function estimateNodeMonthlyCost(type: ComponentType, replicas = 1, config?: Record<string, unknown>): number {
  const base = MONTHLY_COST_USD[type] ?? 10
  
  let scaleMultiplier = 1.0;
  if (config?.scale && config.scale !== 'Auto') {
      scaleMultiplier = SCALE_MULTIPLIERS[String(config.scale)] ?? 1.0;
  }
  
  return base * scaleMultiplier * Math.max(1, replicas)
}

export function estimateTotalMonthlyCost(nodes: { type: ComponentType; replicas?: number; config?: Record<string, unknown> }[]): number {
  return nodes.reduce((sum, n) => sum + estimateNodeMonthlyCost(n.type, n.replicas ?? 1, n.config), 0)
}
