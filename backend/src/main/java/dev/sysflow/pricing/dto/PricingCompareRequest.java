package dev.sysflow.pricing.dto;

import dev.sysflow.simulation.model.SimulationSummary;

import java.util.Collections;
import java.util.List;
import java.util.Map;

public record PricingCompareRequest(
        GraphJson graphJson,
        Double targetRps,
        SimulationSummary simulationSummary
) {
    public record GraphJson(List<NodeJson> nodes, List<EdgeJson> edges) {
        public GraphJson {
            if (nodes == null) nodes = Collections.emptyList();
            if (edges == null) edges = Collections.emptyList();
        }
    }

    public record NodeJson(String id, String type, Map<String, Object> config) {
        public NodeJson {
            if (config == null) config = Collections.emptyMap();
        }
    }

    public record EdgeJson(String id, String source, String target) {
    }
}
