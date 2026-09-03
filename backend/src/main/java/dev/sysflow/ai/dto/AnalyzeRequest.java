package dev.sysflow.ai.dto;

import java.util.List;
import java.util.Map;

public record AnalyzeRequest(GraphJson graphJson, SimulationSummaryJson lastSimulationSummary) {

    public record GraphJson(List<NodeJson> nodes, List<EdgeJson> edges) {
    }

    public record NodeJson(String id, String type, Map<String, Object> config) {
    }

    public record EdgeJson(String id, String source, String target) {
    }

    /**
     * Mirrors dev.sysflow.simulation.model.SimulationSummary; may be null if no
     * simulation has run yet.
     */
    public record SimulationSummaryJson(
            Double avgRps,
            Double avgErrorRatePct,
            Double p95,
            String bottleneckNodeId,
            Double bottleneckLoadPct,
            List<String> singlePointsOfFailure) {
    }
}
