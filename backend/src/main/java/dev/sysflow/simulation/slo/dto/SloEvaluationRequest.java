package dev.sysflow.simulation.slo.dto;

import dev.sysflow.simulation.model.SimulationResult;

/**
 * Request body for {@code POST /api/simulations/evaluate-slo}.
 * <p>
 * Carries an already-computed {@link SimulationResult} (e.g. the response from
 * {@code POST /api/simulations/run}) plus the SLO thresholds to check it against.
 * No simulation is run here — the result is only evaluated.
 */
public record SloEvaluationRequest(
        SimulationResult simulationResult,
        SloRequirement sloRequirement) {
}
