package dev.sysflow.simulation.slo;

import dev.sysflow.simulation.slo.dto.SloEvaluationRequest;
import dev.sysflow.simulation.slo.dto.SloEvaluationResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Separate endpoint for SLO evaluation, kept apart from
 * {@link dev.sysflow.simulation.SimulationController} so that
 * {@code POST /api/simulations/run} continues to return exactly the simulation
 * result it always has. Callers evaluate SLOs against a result they already have
 * (typically the response of {@code /run}) without re-running or duplicating any
 * simulation logic.
 */
@RestController
@RequestMapping("/api/simulations")
public class SloController {

    private final SloEvaluator evaluator;

    public SloController(SloEvaluator evaluator) {
        this.evaluator = evaluator;
    }

    @PostMapping("/evaluate-slo")
    public SloEvaluationResult evaluateSlo(@RequestBody SloEvaluationRequest request) {
        return evaluator.evaluate(request.simulationResult(), request.sloRequirement());
    }
}
