package dev.sysflow.simulation.slo;

import dev.sysflow.simulation.model.SimulationResult;
import dev.sysflow.simulation.model.SimulationSummary;
import dev.sysflow.simulation.slo.dto.SloEvaluationResult;
import dev.sysflow.simulation.slo.dto.SloRequirement;
import dev.sysflow.simulation.slo.dto.SloStatus;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SloEvaluatorTest {

        private final SloEvaluator evaluator = new SloEvaluator();

        private SimulationResult resultWith(double avgRps, double avgErrorRatePct, double p95) {
                SimulationSummary summary = new SimulationSummary(
                                avgRps, avgErrorRatePct, /* p50 */ 0, p95, /* p99 */ 0,
                                /* bottleneckNodeId */ null, /* bottleneckLoadPct */ 0, List.of());
                return new SimulationResult(List.of(), summary);
        }

        // --- P95 latency ---

        @Test
        void p95BelowThresholdPasses() {
                SimulationResult result = resultWith(100, 0, 150);
                SloRequirement req = new SloRequirement(200.0, null, null);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.PASS, evaluation.overallStatus());
                assertEquals(SloStatus.PASS, only(evaluation).status());
        }

        @Test
        void p95EqualToThresholdPasses() {
                SimulationResult result = resultWith(100, 0, 200);
                SloRequirement req = new SloRequirement(200.0, null, null);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.PASS, evaluation.overallStatus());
        }

        @Test
        void p95AboveThresholdFails() {
                SimulationResult result = resultWith(100, 0, 250);
                SloRequirement req = new SloRequirement(200.0, null, null);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.FAIL, evaluation.overallStatus());
                assertEquals(SloStatus.FAIL, only(evaluation).status());
        }

        // --- Error rate ---

        @Test
        void errorRateBelowThresholdPasses() {
                SimulationResult result = resultWith(100, 0.5, 0);
                SloRequirement req = new SloRequirement(null, 1.0, null);

                assertEquals(SloStatus.PASS, evaluator.evaluate(result, req).overallStatus());
        }

        @Test
        void errorRateEqualToThresholdPasses() {
                SimulationResult result = resultWith(100, 1.0, 0);
                SloRequirement req = new SloRequirement(null, 1.0, null);

                assertEquals(SloStatus.PASS, evaluator.evaluate(result, req).overallStatus());
        }

        @Test
        void errorRateAboveThresholdFails() {
                SimulationResult result = resultWith(100, 2.0, 0);
                SloRequirement req = new SloRequirement(null, 1.0, null);

                assertEquals(SloStatus.FAIL, evaluator.evaluate(result, req).overallStatus());
        }

        // --- Throughput ---

        @Test
        void throughputAboveThresholdPasses() {
                SimulationResult result = resultWith(600, 0, 0);
                SloRequirement req = new SloRequirement(null, null, 500.0);

                assertEquals(SloStatus.PASS, evaluator.evaluate(result, req).overallStatus());
        }

        @Test
        void throughputEqualToThresholdPasses() {
                SimulationResult result = resultWith(500, 0, 0);
                SloRequirement req = new SloRequirement(null, null, 500.0);

                assertEquals(SloStatus.PASS, evaluator.evaluate(result, req).overallStatus());
        }

        @Test
        void throughputBelowThresholdFails() {
                SimulationResult result = resultWith(400, 0, 0);
                SloRequirement req = new SloRequirement(null, null, 500.0);

                assertEquals(SloStatus.FAIL, evaluator.evaluate(result, req).overallStatus());
        }

        // --- Overall status combinations ---

        @Test
        void allSlosPassProducesOverallPass() {
                SimulationResult result = resultWith(600, 0.5, 150);
                SloRequirement req = new SloRequirement(200.0, 1.0, 500.0);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.PASS, evaluation.overallStatus());
                assertEquals(3, evaluation.checks().size());
                assertTrue(evaluation.checks().stream().allMatch(c -> c.status() == SloStatus.PASS));
        }

        @Test
        void oneSloFailingProducesOverallFail() {
                SimulationResult result = resultWith(600, 0.5, 250); // p95 fails
                SloRequirement req = new SloRequirement(200.0, 1.0, 500.0);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.FAIL, evaluation.overallStatus());
                assertEquals(1, evaluation.checks().stream().filter(c -> c.status() == SloStatus.FAIL).count());
        }

        @Test
        void multipleSlosFailingProducesOverallFail() {
                SimulationResult result = resultWith(400, 2.0, 250); // all three fail
                SloRequirement req = new SloRequirement(200.0, 1.0, 500.0);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.FAIL, evaluation.overallStatus());
                assertEquals(3, evaluation.checks().stream().filter(c -> c.status() == SloStatus.FAIL).count());
        }

        // --- Disabled / unconfigured SLOs ---

        @Test
        void disabledSloDoesNotAffectOverallResult() {
                // p95 would fail (300 > 200) if configured, but it's left null (disabled).
                SimulationResult result = resultWith(600, 0.5, 300);
                SloRequirement req = new SloRequirement(null, 1.0, 500.0);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.PASS, evaluation.overallStatus());
                assertEquals(2, evaluation.checks().size());
                assertTrue(evaluation.checks().stream().noneMatch(c -> c.name().equals("maxP95LatencyMs")));
        }

        @Test
        void mixedConfiguredAndDisabledSlos() {
                // Only throughput configured; it fails. Others disabled and must not appear.
                SimulationResult result = resultWith(100, 0, 0);
                SloRequirement req = new SloRequirement(null, null, 500.0);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.FAIL, evaluation.overallStatus());
                assertEquals(1, evaluation.checks().size());
                assertEquals("minThroughputRps", only(evaluation).name());
                assertEquals(SloStatus.FAIL, only(evaluation).status());
        }

        @Test
        void allSlosDisabledProducesOverallPassWithNoChecks() {
                SimulationResult result = resultWith(0, 0, 0);
                SloRequirement req = new SloRequirement(null, null, null);

                SloEvaluationResult evaluation = evaluator.evaluate(result, req);

                assertEquals(SloStatus.PASS, evaluation.overallStatus());
                assertTrue(evaluation.checks().isEmpty());
        }

        private SloEvaluationResult.SloCheckResult only(SloEvaluationResult evaluation) {
                assertEquals(1, evaluation.checks().size());
                return evaluation.checks().get(0);
        }
}
