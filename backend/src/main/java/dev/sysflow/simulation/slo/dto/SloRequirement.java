package dev.sysflow.simulation.slo.dto;

/**
 * SLO thresholds to evaluate against an existing {@link dev.sysflow.simulation.model.SimulationResult}.
 * <p>
 * Each field is nullable/boxed so a caller can omit ("disable") any individual
 * SLO without affecting the others or the overall result — see
 * {@link dev.sysflow.simulation.slo.SloEvaluator}.
 */
public record SloRequirement(
        Double maxP95LatencyMs,
        Double maxErrorRatePercent,
        Double minThroughputRps) {
}
