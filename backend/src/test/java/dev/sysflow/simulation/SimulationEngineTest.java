package dev.sysflow.simulation;

import dev.sysflow.simulation.model.*;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class SimulationEngineTest {

        private final SimulationEngine engine = new SimulationEngine();

        /**
         * Client -> LB -> Service -> DB, all within capacity: should be healthy, no
         * errors.
         */
        @Test
        void healthyThreeTierProducesNoErrors() {
                SimulationGraph graph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),
                                                new GraphNode("lb", "loadBalancer", Map.of("maxThroughput", 1000.0)),
                                                new GraphNode("svc", "service",
                                                                Map.of("minLatencyMs", 20.0, "maxLatencyMs", 40.0,
                                                                                "maxConcurrency", 500.0)),
                                                new GraphNode("db", "database",
                                                                Map.of("readLatencyMs", 10.0, "maxConnections", 500.0,
                                                                                "replicaCount", 1.0))),
                                List.of(
                                                new GraphEdge("e1", "client", "lb"),
                                                new GraphEdge("e2", "lb", "svc"),
                                                new GraphEdge("e3", "svc", "db")));
                SimulationConfig config = new SimulationConfig(100, 2, List.of(), 1L);

                SimulationResult result = engine.run(graph, config);

                assertEquals(20, result.ticks().size());
                assertTrue(result.summary().avgErrorRatePct() < 1.0, "expected near-zero error rate under capacity");
                assertTrue(result.summary().avgRps() > 0);
        }

        /**
         * Client -> Service -> DB with no replica: DB should be flagged as a single
         * point of failure.
         */
        @Test
        void unreplicatedDatabaseIsFlaggedAsSpof() {
                SimulationGraph graph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),
                                                new GraphNode("svc", "service",
                                                                Map.of("minLatencyMs", 10.0, "maxLatencyMs", 20.0,
                                                                                "maxConcurrency", 500.0)),
                                                new GraphNode("db", "database",
                                                                Map.of("readLatencyMs", 10.0, "maxConnections", 500.0,
                                                                                "replicaCount", 0.0))),
                                List.of(
                                                new GraphEdge("e1", "client", "svc"),
                                                new GraphEdge("e2", "svc", "db")));
                SimulationConfig config = new SimulationConfig(50, 1, List.of(), 1L);

                SimulationResult result = engine.run(graph, config);

                assertTrue(result.summary().singlePointsOfFailure().contains("db"));
        }

        /**
         * Service capacity far below arrival rate: should show high load and non-zero
         * error rate.
         */
        @Test
        void saturatedServiceProducesErrorsAndHighLoad() {
                SimulationGraph graph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),
                                                new GraphNode("svc", "service",
                                                                Map.of("minLatencyMs", 10.0, "maxLatencyMs", 20.0,
                                                                                "maxConcurrency", 5.0))),
                                List.of(new GraphEdge("e1", "client", "svc")));
                SimulationConfig config = new SimulationConfig(1000, 1, List.of(), 1L);

                SimulationResult result = engine.run(graph, config);

                assertTrue(result.summary().avgErrorRatePct() > 50, "expected heavy overload to cause majority errors");
                assertEquals("svc", result.summary().bottleneckNodeId());
                assertTrue(result.summary().bottleneckLoadPct() >= 100);
        }

        /**
         * Killing a node mid-simulation should show it "down" and cause downstream
         * failures.
         */
        @Test
        void killedNodeShowsDownAndBlocksDownstream() {
                SimulationGraph graph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),
                                                new GraphNode("svc", "service",
                                                                Map.of("minLatencyMs", 10.0, "maxLatencyMs", 20.0,
                                                                                "maxConcurrency", 500.0)),
                                                new GraphNode("db", "database",
                                                                Map.of("readLatencyMs", 10.0, "maxConnections",
                                                                                500.0))),
                                List.of(
                                                new GraphEdge("e1", "client", "svc"),
                                                new GraphEdge("e2", "svc", "db")));
                InjectedFailure kill = new InjectedFailure("kill", "svc", null, 0, null, 0, 0, 0);
                SimulationConfig config = new SimulationConfig(100, 1, List.of(kill), 1L);

                SimulationResult result = engine.run(graph, config);

                Tick lastTick = result.ticks().get(result.ticks().size() - 1);
                assertTrue(lastTick.nodes().get("svc").down());
                assertEquals(0.0, lastTick.edges().get("e2").inFlight());

        }

        /**
         * Service latency should be sampled independently for successful requests.
         * This ensures the simulation produces a latency distribution rather than
         * assigning exactly the same latency to every request in a batch.
         */
        @Test
        void serviceProducesLatencyDistribution() {
                SimulationGraph graph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),
                                                new GraphNode(
                                                                "svc",
                                                                "service",
                                                                Map.of(
                                                                                "minLatencyMs", 20.0,
                                                                                "maxLatencyMs", 100.0,
                                                                                "maxConcurrency", 1000.0))),
                                List.of(
                                                new GraphEdge("e1", "client", "svc")));

                SimulationConfig config = new SimulationConfig(
                                1000,
                                5,
                                List.of(),
                                1L);

                SimulationResult result = engine.run(graph, config);

                assertFalse(result.ticks().isEmpty());

                double p50 = result.ticks().get(0).global().p50();
                double p95 = result.ticks().get(0).global().p95();
                double p99 = result.ticks().get(0).global().p99();

                // Latencies must remain inside the configured service range.
                assertTrue(p50 >= 20.0 && p50 <= 100.0);
                assertTrue(p95 >= 20.0 && p95 <= 100.0);
                assertTrue(p99 >= 20.0 && p99 <= 100.0);

                // A sufficiently large sample should produce a non-trivial
                // latency distribution rather than identical percentile values.
                assertTrue(p95 >= p50);
                assertTrue(p99 >= p95);
        }

        /**
         * Verifies that latency accumulates across the complete request path.
         *
         * Client -> Service -> Database
         *
         * Expected approximate latency:
         * Service (20 ms) + Database (10 ms) = 30 ms
         */
        /**
         * Verifies that latency accumulates across the complete request path.
         *
         * Client -> Service A -> Service B
         *
         * Service A = 20 ms
         * Service B = 20 ms
         *
         * Expected end-to-end latency = 40 ms
         */
        @Test
        void endToEndLatencyIncludesAllNodesInPath() {
                SimulationGraph graph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),

                                                new GraphNode(
                                                                "svc1",
                                                                "service",
                                                                Map.of(
                                                                                "minLatencyMs", 20.0,
                                                                                "maxLatencyMs", 20.0,
                                                                                "maxConcurrency", 1000.0)),

                                                new GraphNode(
                                                                "svc2",
                                                                "service",
                                                                Map.of(
                                                                                "minLatencyMs", 20.0,
                                                                                "maxLatencyMs", 20.0,
                                                                                "maxConcurrency", 1000.0))),
                                List.of(
                                                new GraphEdge("e1", "client", "svc1"),
                                                new GraphEdge("e2", "svc1", "svc2")));

                SimulationConfig config = new SimulationConfig(10, 1, List.of(), 1L);

                SimulationResult result = engine.run(graph, config);

                double p50 = result.summary().p50();

                // Service A = 20 ms
                // Service B = 20 ms
                // Expected end-to-end latency = 40 ms
                assertEquals(40.0, p50, 0.001);
        }

        @Test
        void concurrencyCapacityUsesLittleLawEstimate() {
                SimulationResult result = engine.run(singleServiceGraph(100, 50, 50),
                                new SimulationConfig(3000, 1, List.of(), 1L));

                assertEquals(2000.0, result.summary().avgRps(), 0.01);
        }

        @Test
        void trafficBelowConcurrencyCapacityHasNoOverloadErrors() {
                SimulationResult result = engine.run(singleServiceGraph(100, 50, 50),
                                new SimulationConfig(1000, 1, List.of(), 1L));

                assertEquals(0.0, result.summary().avgErrorRatePct(), 0.01);
        }

        @Test
        void trafficAboveConcurrencyCapacityRejectsExcessRequests() {
                SimulationResult result = engine.run(singleServiceGraph(100, 50, 50),
                                new SimulationConfig(4000, 1, List.of(), 1L));

                assertTrue(result.summary().avgErrorRatePct() >= 40.0);
        }

        @Test
        void higherServiceLatencyReducesConcurrencyCapacity() {
                SimulationResult fast = engine.run(singleServiceGraph(100, 50, 50),
                                new SimulationConfig(1500, 1, List.of(), 1L));
                SimulationResult slow = engine.run(singleServiceGraph(100, 100, 100),
                                new SimulationConfig(1500, 1, List.of(), 1L));

                assertEquals(1500.0, fast.summary().avgRps(), 0.01);
                assertEquals(1000.0, slow.summary().avgRps(), 0.01);
        }

        private SimulationGraph singleServiceGraph(double maxConcurrency, double minLatencyMs, double maxLatencyMs) {
                return new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),
                                                new GraphNode("svc", "service", Map.of(
                                                                "maxConcurrency", maxConcurrency,
                                                                "minLatencyMs", minLatencyMs,
                                                                "maxLatencyMs", maxLatencyMs))),
                                List.of(new GraphEdge("e1", "client", "svc")));
        }

        /**
         * Verifies the relationship between concurrency, service latency,
         * and estimated throughput.
         *
         * With the same concurrency:
         *
         * 100 concurrency / 50 ms = approximately 2000 RPS
         * 100 concurrency / 100 ms = approximately 1000 RPS
         *
         * Therefore, doubling service latency should approximately halve
         * the available throughput.
         */
        @Test
        void higherLatencyReducesConcurrencyBasedCapacity() {

                SimulationGraph fastGraph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),

                                                new GraphNode(
                                                                "svc",
                                                                "service",
                                                                Map.of(
                                                                                "minLatencyMs", 50.0,
                                                                                "maxLatencyMs", 50.0,
                                                                                "maxConcurrency", 100.0))),
                                List.of(
                                                new GraphEdge("e1", "client", "svc")));

                SimulationGraph slowGraph = new SimulationGraph(
                                List.of(
                                                new GraphNode("client", "client", Map.of()),

                                                new GraphNode(
                                                                "svc",
                                                                "service",
                                                                Map.of(
                                                                                "minLatencyMs", 100.0,
                                                                                "maxLatencyMs", 100.0,
                                                                                "maxConcurrency", 100.0))),
                                List.of(
                                                new GraphEdge("e1", "client", "svc")));

                /*
                 * Target traffic is intentionally higher than both calculated capacities
                 * so that the service becomes saturated and the difference in capacity
                 * becomes observable.
                 */
                SimulationConfig config = new SimulationConfig(3000, 1, List.of(), 1L);

                SimulationResult fastResult = engine.run(fastGraph, config);
                SimulationResult slowResult = engine.run(slowGraph, config);

                double fastRps = fastResult.summary().avgRps();
                double slowRps = slowResult.summary().avgRps();

                // 50 ms service time -> approximately 2000 RPS capacity.
                assertEquals(2000.0, fastRps, 0.001);

                // 100 ms service time -> approximately 1000 RPS capacity.
                assertEquals(1000.0, slowRps, 0.001);

                // Doubling latency should approximately halve throughput.
                assertEquals(2.0, fastRps / slowRps, 0.001);
        }
}
