package dev.sysflow.simulation.slo;

import dev.sysflow.simulation.model.SimulationResult;
import dev.sysflow.simulation.model.SimulationSummary;
import dev.sysflow.simulation.slo.dto.SloEvaluationResult;
import dev.sysflow.simulation.slo.dto.SloEvaluationResult.SloCheckResult;
import dev.sysflow.simulation.slo.dto.SloRequirement;
import dev.sysflow.simulation.slo.dto.SloStatus;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Evaluates SLOs against an already-computed {@link SimulationResult}.
 * <p>
 * This is a read-only layer on top of {@link dev.sysflow.simulation.SimulationEngine}
 * output: it does not run a simulation and does not recalculate any simulation
 * metric (latency, throughput, error rate, etc). It only compares the values
 * already present on {@link SimulationSummary} against the thresholds in a
 * {@link SloRequirement}.
 * <p>
 * A null field on {@link SloRequirement} means that SLO is disabled/unconfigured:
 * it is skipped entirely and has no effect on {@link SloEvaluationResult#overallStatus()}.
 */
@Component
public class SloEvaluator {

    public SloEvaluationResult evaluate(SimulationResult result, SloRequirement requirement) {
        SimulationSummary summary = result.summary();
        List<SloCheckResult> checks = new ArrayList<>();

        if (requirement.maxP95LatencyMs() != null) {
            checks.add(check("maxP95LatencyMs", summary.p95(), requirement.maxP95LatencyMs(), true));
        }
        if (requirement.maxErrorRatePercent() != null) {
            checks.add(check("maxErrorRatePercent", summary.avgErrorRatePct(), requirement.maxErrorRatePercent(), true));
        }
        if (requirement.minThroughputRps() != null) {
            checks.add(check("minThroughputRps", summary.avgRps(), requirement.minThroughputRps(), false));
        }

        boolean allPass = checks.stream().allMatch(c -> c.status() == SloStatus.PASS);
        SloStatus overallStatus = allPass ? SloStatus.PASS : SloStatus.FAIL;

        return new SloEvaluationResult(overallStatus, checks);
    }

    /**
     * @param upperBound true for "actual must be <= threshold" SLOs (latency, error rate);
     *                   false for "actual must be >= threshold" SLOs (throughput).
     */
    private SloCheckResult check(String name, double actual, double threshold, boolean upperBound) {
        boolean pass = upperBound ? actual <= threshold : actual >= threshold;
        return new SloCheckResult(name, actual, threshold, pass ? SloStatus.PASS : SloStatus.FAIL);
    }
}
