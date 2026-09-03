package dev.sysflow.simulation;

import dev.sysflow.simulation.model.*;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Tick-based, probabilistic simulation engine.
 *
 * This is intentionally NOT a discrete-event / queueing-theory accurate
 * network simulator. Per docs/02-ARCHITECTURE.md §4, it's a simplified
 * analytical model: on each tick, request flow is propagated in
 * topological order from Client nodes downward, latency is sampled per
 * node from its configured distribution, and nodes over capacity fail
 * the excess. This is tractable, deterministic given a seed, and good
 * enough to teach the tradeoffs the product cares about (bottlenecks,
 * SPOFs, cascading failure) without modeling real TCP/OS behavior.
 */
@Component
public class SimulationEngine {

    public SimulationResult run(SimulationGraph graph, SimulationConfig config) {
        List<GraphNode> topoOrder = graph.topologicalOrder();
        List<Tick> ticks = new ArrayList<>(config.totalTicks());
        Random random = new Random(config.randomSeed());

        double sumRps = 0, sumErrorRate = 0;
        Map<String, Double> maxLoadByNode = new HashMap<>();
        Map<String, Integer> asgReplicas = new HashMap<>();
        List<Double> latencySamples = new ArrayList<>();
        for (int t = 0; t < config.totalTicks(); t++) {
            Map<String, InjectedFailure> activeNodeFailures = activeFailuresByNode(config, t);
            Map<String, InjectedFailure> activeEdgeFailures = activeFailuresByEdge(config, t);

            Map<String, Double> incomingRate = new HashMap<>();
            Map<String, Double> incomingFailedRate = new HashMap<>();
            Map<String, NodeTickStats> nodeStats = new LinkedHashMap<>();
            Map<String, EdgeTickStats> edgeStats = new LinkedHashMap<>();

            // Tracks the total latency accumulated by requests reaching each node.
            // The value is latency-weighted by the incoming request rate.
            Map<String, Double> incomingLatencyWeighted = new HashMap<>();

            double perClientArrival = (config.targetRps() / SimulationConfig.TICKS_PER_SECOND)
                    / Math.max(1, graph.clientNodes().size());
            for (GraphNode client : graph.clientNodes()) {
                incomingRate.merge(client.id(), perClientArrival, Double::sum);

                // Client-side starting point: no backend latency has been accumulated yet.
                incomingLatencyWeighted.merge(client.id(), 0.0, Double::sum);
            }

            double totalAttempted = 0;
            double totalFailed = 0;
            double totalLatencyWeighted = 0;
            double totalSucceeded = 0;
            // Stores latency observations completed during this tick only.
            // Used for calculating tick-level p50, p95 and p99.
            List<Double> tickLatencySamples = new ArrayList<>();
            for (GraphNode node : topoOrder) {
                double arriving = incomingRate.getOrDefault(node.id(), 0.0);
                double arrivingFailed = incomingFailedRate.getOrDefault(node.id(), 0.0);

                double incomingLatency = incomingLatencyWeighted.getOrDefault(node.id(), 0.0);

                // Convert latency-weighted traffic into the average latency already
                // accumulated by requests reaching this node.
                double averageIncomingLatency = arriving <= 0
                        ? 0.0
                        : incomingLatency / arriving;

                boolean isClient = "client".equals(node.type());

                InjectedFailure killOrDegrade = activeNodeFailures.get(node.id());
                boolean killed = killOrDegrade != null && "kill".equals(killOrDegrade.type());

                int replicas = 1;
                if ("autoScalingGroup".equals(node.type())) {
                    replicas = asgReplicas.getOrDefault(node.id(), (int) node.getNumber("minReplicas", 1));
                }

                double baseCapacity = capacityOf(node);
                double capacity = "autoScalingGroup".equals(node.type()) ? baseCapacity * replicas : baseCapacity;
                double effectiveCapacity = killOrDegrade != null && "throttle".equals(killOrDegrade.type())
                        ? capacity * (1 - clampPct(killOrDegrade.throttlePct()))
                        : capacity;

                double accepted;
                double failedHere;
                if (killed) {
                    accepted = 0;
                    failedHere = arriving;
                } else if (isClient) {
                    accepted = arriving;
                    failedHere = arrivingFailed;
                } else if (arriving <= effectiveCapacity) {
                    accepted = arriving;
                    failedHere = arrivingFailed;
                } else {
                    accepted = effectiveCapacity;
                    failedHere = arrivingFailed + (arriving - effectiveCapacity);
                }

                double baseLatency = isClient ? 0 : latencyOf(node, random);
                double extraLatency = killOrDegrade != null && "latency".equals(killOrDegrade.type())
                        ? killOrDegrade.extraMs()
                        : 0;
                double nodeLatency = baseLatency + extraLatency;
                // End-to-end latency up to this node = latency already accumulated
                // by the request + latency introduced by the current node.
                double cumulativeLatency = averageIncomingLatency + nodeLatency;

                double loadPct = effectiveCapacity <= 0 ? (arriving > 0 ? 200 : 0)
                        : Math.min(200, (arriving / effectiveCapacity) * 100);
                double totalIn = arriving + arrivingFailed;
                double errorRatePct = totalIn <= 0 ? 0 : Math.min(100, (failedHere / totalIn) * 100);

                nodeStats.put(node.id(), new NodeTickStats(round2(loadPct), round2(errorRatePct), round2(nodeLatency),
                        killed, replicas));

                if ("autoScalingGroup".equals(node.type())) {
                    double targetLoad = node.getNumber("targetLoadPct", 70);
                    int maxReplicas = (int) node.getNumber("maxReplicas", 10);
                    int minReplicas = (int) node.getNumber("minReplicas", 1);
                    if (loadPct > targetLoad && replicas < maxReplicas) {
                        asgReplicas.put(node.id(), replicas + 1);
                    } else if (loadPct < (targetLoad - 20) && replicas > minReplicas) {
                        asgReplicas.put(node.id(), replicas - 1);
                    } else {
                        asgReplicas.put(node.id(), replicas);
                    }
                }
                if (graph.outgoing(node.id()).isEmpty() && !isClient) {
                    totalAttempted += arriving + arrivingFailed;
                    totalFailed += failedHere;
                    totalSucceeded += accepted;
                    totalLatencyWeighted += accepted * nodeLatency;

                    // Store each successful request's latency so that
                    // percentiles are calculated from the actual latency distribution.
                    int successfulRequests = (int) Math.round(accepted);
                    for (int i = 0; i < successfulRequests; i++) {
                        // At a terminal node, the request's latency represents the complete
                        // end-to-end latency accumulated across the path.
                        double requestLatency = cumulativeLatency;

                        // Keep the sample for the current tick.
                        tickLatencySamples.add(requestLatency);

                        // Keep the sample for the complete simulation run.
                        latencySamples.add(requestLatency);
                    }
                }

                maxLoadByNode.merge(node.id(), loadPct, Math::max);

                List<GraphEdge> outEdges = graph.outgoing(node.id());
                if (!outEdges.isEmpty()) {
                    double sharePerEdge = accepted / outEdges.size();
                    double failedSharePerEdge = failedHere / Math.max(1, outEdges.size());
                    for (GraphEdge edge : outEdges) {
                        InjectedFailure edgeFailure = activeEdgeFailures.get(edge.id());
                        double dropPct = edgeFailure != null ? clampPct(edgeFailure.dropPct()) : 0;
                        double dropped = sharePerEdge * dropPct;
                        double forwarded = sharePerEdge - dropped;

                        incomingRate.merge(edge.target(), forwarded, Double::sum);
                        incomingFailedRate.merge(
                                edge.target(),
                                failedSharePerEdge + dropped,
                                Double::sum);

                        // Propagate the accumulated end-to-end latency with the forwarded traffic.
                        // Each forwarded request arriving at the next node has already experienced
                        // the latency accumulated up to the current node.
                        incomingLatencyWeighted.merge(
                                edge.target(),
                                forwarded * cumulativeLatency,
                                Double::sum);

                        edgeStats.put(
                                edge.id(),
                                new EdgeTickStats(round2(forwarded), round2(nodeLatency)));
                    }
                } else if (!isClient) {
                    // terminal node — nothing to forward
                }
            }

            double tickRps = totalSucceeded * SimulationConfig.TICKS_PER_SECOND;
            double tickErrorRate = totalAttempted <= 0 ? 0 : (totalFailed / totalAttempted) * 100;

            // Calculate percentiles using only requests completed in this tick.
            double p50 = percentile(tickLatencySamples, 0.50);
            double p95 = percentile(tickLatencySamples, 0.95);
            double p99 = percentile(tickLatencySamples, 0.99);
            sumRps += tickRps;
            sumErrorRate += tickErrorRate;

            ticks.add(new Tick(t, nodeStats, edgeStats,
                    new GlobalTickStats(round2(tickRps), round2(tickErrorRate), round2(p50), round2(p95),
                            round2(p99))));
        }
        // Calculate latency percentiles from every successful request
        // collected during the complete simulation run.
        double overallP50 = percentile(latencySamples, 0.50);
        double overallP95 = percentile(latencySamples, 0.95);
        double overallP99 = percentile(latencySamples, 0.99);
        int n = Math.max(1, ticks.size());
        String bottleneckId = maxLoadByNode.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(null);
        double bottleneckLoad = bottleneckId == null ? 0 : maxLoadByNode.get(bottleneckId);

        List<String> spofs = graph.nodes().stream()
                .filter(node -> !"client".equals(node.type()))
                .filter(node -> graph.incoming(node.id()).size() >= 1)
                .filter(node -> isUnreplicated(node))
                .filter(node -> hasMultipleDependents(graph, node))
                .map(GraphNode::id)
                .toList();

        SimulationSummary summary = new SimulationSummary(
                round2(sumRps / n),
                round2(sumErrorRate / n),
                round2(overallP50),
                round2(overallP95),
                round2(overallP99),
                bottleneckId,
                round2(bottleneckLoad),
                spofs);

        return new SimulationResult(ticks, summary);
    }

    /**
     * Calculates a percentile using the nearest-rank method.
     *
     * The latency observations are sorted first, then the position is
     * determined using: rank = ceil(percentile * numberOfSamples).
     *
     * Example:
     * p95 with 100 samples -> 95th ranked latency value.
     */
    private double percentile(List<Double> values, double percentile) {
        // No observations means there is no percentile to calculate.
        if (values == null || values.isEmpty()) {
            return 0.0;
        }

        // Sort a copy so that the original latency sample list is unchanged.
        List<Double> sorted = new ArrayList<>(values);
        Collections.sort(sorted);

        // Convert the percentile into a nearest-rank position.
        int rank = (int) Math.ceil(percentile * sorted.size());

        // Convert the 1-based rank into a 0-based Java list index.
        int index = Math.max(0, rank - 1);

        return sorted.get(index);
    }

    private boolean isUnreplicated(GraphNode node) {
        if ("database".equals(node.type()) || "searchIndex".equals(node.type())) {
            return node.getNumber("replicaCount", 0) <= 0;
        }
        return "service".equals(node.type()) || "cache".equals(node.type()) || "queue".equals(node.type())
                || "messageBroker".equals(node.type()) || "dataWarehouse".equals(node.type());
    }

    private boolean hasMultipleDependents(SimulationGraph graph, GraphNode node) {
        // A node fed by a load balancer/gateway (i.e. has upstream fan-in) is presumed
        // to be the sole handler for that traffic — flag it unless it's explicitly
        // replicated.
        return !graph.incoming(node.id()).isEmpty();
    }

    private Map<String, InjectedFailure> activeFailuresByNode(SimulationConfig config, int tick) {
        Map<String, InjectedFailure> map = new HashMap<>();
        for (InjectedFailure f : config.injectedFailures()) {
            if (f.nodeId() != null && f.activeAt(tick))
                map.put(f.nodeId(), f);
        }
        return map;
    }

    private Map<String, InjectedFailure> activeFailuresByEdge(SimulationConfig config, int tick) {
        Map<String, InjectedFailure> map = new HashMap<>();
        for (InjectedFailure f : config.injectedFailures()) {
            if (f.edgeId() != null && f.activeAt(tick))
                map.put(f.edgeId(), f);
        }
        return map;
    }

    private double capacityOf(GraphNode node) {
        return switch (node.type()) {
            case "client", "mobile", "webBrowser", "iotDevice" -> Double.MAX_VALUE;
            case "dns" -> Double.MAX_VALUE;
            case "cdn" -> node.getNumber("maxThroughput", 5000);
            case "loadBalancer" -> node.getNumber("maxThroughput", 1000);
            case "apiGateway" -> node.getNumber("rateLimit", 500);
            case "waf" -> node.getNumber("maxThroughput", 2000);
            case "ingress" -> node.getNumber("maxThroughput", 1500);
            case "service" -> concurrencyCapacityPerTick(node, "maxConcurrency", 500);
            case "worker" -> concurrencyCapacityPerTick(node, "maxConcurrency", 300);
            case "serverless" -> concurrencyCapacityPerTick(node, "maxConcurrency", 1000);
            case "autoScalingGroup", "containerOrchestrator" -> concurrencyCapacityPerTick(
                    node, "baseCapacityPerReplica", 500);
            case "cronJob" -> concurrencyCapacityPerTick(node, "maxConcurrency", 50);
            case "cache" -> Double.MAX_VALUE;
            case "database" -> node.getNumber("maxConnections", 200);
            case "dataWarehouse" -> node.getNumber("maxConnections", 100);
            case "queue" -> node.getNumber("maxThroughput", 1000);
            case "objectStorage" -> node.getNumber("maxThroughput", 3000);
            case "searchIndex" -> node.getNumber("maxConnections", 300);
            case "dataLake" -> node.getNumber("maxConnections", 100);
            case "messageBroker" -> node.getNumber("maxThroughput", 2000);
            case "eventBus" -> node.getNumber("maxThroughput", 3000);
            case "webhook" -> node.getNumber("maxThroughput", 300);
            case "monitoring", "logging" -> node.getNumber("maxThroughput", 5000);
            case "thirdPartyApi" -> node.getNumber("maxThroughput", 200);
            case "paymentGateway" -> node.getNumber("maxThroughput", 150);
            default -> 1000;
        };
    }

    private double concurrencyCapacityPerTick(GraphNode node, String concurrencyKey, double defaultConcurrency) {
        double effectiveConcurrency = node.getNumber(concurrencyKey, defaultConcurrency);
        if (!Double.isFinite(effectiveConcurrency) || effectiveConcurrency <= 0) {
            return 0;
        }

        // Use the midpoint of the configured latency range as representative service
        // time.
        double minLatencyMs = node.getNumber("minLatencyMs", 20);
        double maxLatencyMs = node.getNumber("maxLatencyMs", 80);
        double averageLatencySeconds = ((minLatencyMs + maxLatencyMs) / 2.0) / 1000.0;
        if (!Double.isFinite(averageLatencySeconds) || averageLatencySeconds <= 0) {
            return 0;
        }

        double capacityRps = effectiveConcurrency / averageLatencySeconds;
        if (!Double.isFinite(capacityRps)) {
            return Double.MAX_VALUE;
        }
        return Math.min(Double.MAX_VALUE, capacityRps / SimulationConfig.TICKS_PER_SECOND);
    }

    private double latencyOf(GraphNode node, Random random) {
        return switch (node.type()) {
            case "dns" -> node.getNumber("resolutionLatencyMs", 5);
            case "cdn" -> {
                double hitRate = clampPct(node.getNumber("hitRatePct", 90) / 100.0);
                double hitLatency = node.getNumber("hitLatencyMs", 3);
                double missLatency = node.getNumber("missLatencyMs", 35);
                yield random.nextDouble() < hitRate ? hitLatency : missLatency;
            }
            case "loadBalancer" -> 1 + random.nextDouble() * 2;
            case "apiGateway" -> 2 + random.nextDouble() * 3;
            case "waf" -> node.getNumber("extraLatencyMs", 2) + random.nextDouble() * 2;
            case "ingress" -> 1 + random.nextDouble() * 2;
            case "service", "worker", "serverless", "autoScalingGroup", "containerOrchestrator", "cronJob" -> {
                double min = node.getNumber("minLatencyMs", 20);
                double max = node.getNumber("maxLatencyMs", 80);
                yield min + random.nextDouble() * Math.max(0, max - min);
            }
            case "cache" -> {
                double hitRate = clampPct(node.getNumber("hitRatePct", 80) / 100.0);
                double hitLatency = node.getNumber("hitLatencyMs", 2);
                double missLatency = node.getNumber("missLatencyMs", 40);
                yield random.nextDouble() < hitRate ? hitLatency : missLatency;
            }
            case "database" -> node.getNumber("readLatencyMs", 15) + random.nextDouble() * 5;
            case "dataWarehouse" -> node.getNumber("readLatencyMs", 60) + random.nextDouble() * 15;
            case "objectStorage" -> node.getNumber("readLatencyMs", 25) + random.nextDouble() * 10;
            case "searchIndex" -> node.getNumber("readLatencyMs", 20) + random.nextDouble() * 8;
            case "dataLake" -> node.getNumber("readLatencyMs", 80) + random.nextDouble() * 20;
            case "queue", "messageBroker" -> 5 + random.nextDouble() * 10;
            case "eventBus" -> 2 + random.nextDouble() * 5;
            case "webhook" -> node.getNumber("extraLatencyMs", 20) + random.nextDouble() * 30;
            case "monitoring", "logging" -> 1 + random.nextDouble() * 2;
            case "thirdPartyApi" -> node.getNumber("minLatencyMs", 50) + random.nextDouble()
                    * Math.max(0, node.getNumber("maxLatencyMs", 400) - node.getNumber("minLatencyMs", 50));
            case "paymentGateway" -> node.getNumber("minLatencyMs", 100) + random.nextDouble()
                    * Math.max(0, node.getNumber("maxLatencyMs", 600) - node.getNumber("minLatencyMs", 100));
            default -> 5;
        };
    }

    private double clampPct(double v) {
        return Math.max(0, Math.min(1, v > 1 ? v / 100.0 : v));
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

}
