package dev.sysflow.simulation.model;

import java.util.List;

public record SimulationSummary(
                double avgRps,
                double avgErrorRatePct,
                double p50,
                double p95,
                double p99,
                String bottleneckNodeId,
                double bottleneckLoadPct,
                List<String> singlePointsOfFailure) {
}