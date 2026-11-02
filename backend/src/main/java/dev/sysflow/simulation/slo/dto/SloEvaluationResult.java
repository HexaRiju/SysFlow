package dev.sysflow.simulation.slo.dto;

import java.util.List;

public record SloEvaluationResult(
        SloStatus overallStatus,
        List<SloCheckResult> checks) {

    /**
     * Result of evaluating a single, configured SLO. Disabled/unconfigured SLOs
     * are not included here and do not affect {@link #overallStatus()}.
     */
    public record SloCheckResult(
            String name,
            double actualValue,
            double thresholdValue,
            SloStatus status) {
    }
}
