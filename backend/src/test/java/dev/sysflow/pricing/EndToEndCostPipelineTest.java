package dev.sysflow.pricing;

import dev.sysflow.common.CostModel;
import dev.sysflow.pricing.dto.PricingCompareRequest;
import dev.sysflow.pricing.dto.PricingCompareResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class EndToEndCostPipelineTest {

    private EndToEndCostPipeline pipeline;

    @BeforeEach
    void setUp() {
        CostModel costModel = new CostModel();
        AwsPricingClient aws = new AwsPricingClient();
        GcpPricingClient gcp = new GcpPricingClient();
        AzurePricingClient azure = new AzurePricingClient();
        pipeline = new EndToEndCostPipeline(costModel, List.of(aws, gcp, azure));
    }

    @Test
    void calculatesMultiCloudCostsForGenericComputeAndDatabase() {
        var req = new PricingCompareRequest(
                new PricingCompareRequest.GraphJson(
                        List.of(
                                new PricingCompareRequest.NodeJson("svc", "service", Map.of("maxConcurrency", 500)),
                                new PricingCompareRequest.NodeJson("db", "database", Map.of("maxConnections", 50))
                        ),
                        List.of()
                ),
                100.0,
                null
        );

        PricingCompareResponse res = pipeline.compare(req);

        assertNotNull(res);
        assertEquals(3, res.providers().size());
        assertTrue(res.providers().containsKey("aws"));
        assertTrue(res.providers().containsKey("gcp"));
        assertTrue(res.providers().containsKey("azure"));

        // All providers should have positive monthly cost
        for (var p : res.providers().values()) {
            assertTrue(p.totalMonthlyCostUsd() > 0, p.providerId() + " total cost should be > 0");
            assertTrue(p.provisionedCostUsd() > 0, p.providerId() + " provisioned cost should be > 0");
            assertEquals(2, p.nodes().size());
        }

        assertFalse(res.bestValueProvider().isBlank());
    }

    @Test
    void cdnReducesEgressAndProvidesSavings() {
        var withoutCdn = new PricingCompareRequest(
                new PricingCompareRequest.GraphJson(
                        List.of(
                                new PricingCompareRequest.NodeJson("client", "client", Map.of("targetRps", 500)),
                                new PricingCompareRequest.NodeJson("svc", "service", Map.of())
                        ),
                        List.of()
                ),
                500.0,
                null
        );

        var withCdn = new PricingCompareRequest(
                new PricingCompareRequest.GraphJson(
                        List.of(
                                new PricingCompareRequest.NodeJson("client", "client", Map.of("targetRps", 500)),
                                new PricingCompareRequest.NodeJson("cdn", "cdn", Map.of("hitRatePct", 90)),
                                new PricingCompareRequest.NodeJson("svc", "service", Map.of())
                        ),
                        List.of()
                ),
                500.0,
                null
        );

        PricingCompareResponse resNoCdn = pipeline.compare(withoutCdn);
        PricingCompareResponse resWithCdn = pipeline.compare(withCdn);

        double egressNoCdn = resNoCdn.providers().get("aws").egressCostUsd();
        double egressWithCdn = resWithCdn.providers().get("aws").egressCostUsd();

        assertTrue(egressWithCdn < egressNoCdn, "CDN should reduce net egress cost");
        assertTrue(resWithCdn.providers().get("aws").cacheSavingsUsd() > 0, "Cache savings should be positive");
    }

    @Test
    void dynamicRequestsAreBilledForApiGateway() {
        var req = new PricingCompareRequest(
                new PricingCompareRequest.GraphJson(
                        List.of(
                                new PricingCompareRequest.NodeJson("gw", "apiGateway", Map.of()),
                                new PricingCompareRequest.NodeJson("svc", "service", Map.of())
                        ),
                        List.of()
                ),
                200.0,
                null
        );

        PricingCompareResponse res = pipeline.compare(req);
        var awsSummary = res.providers().get("aws");

        // AWS HTTP API Gateway is $1.00 / million requests
        assertTrue(awsSummary.dynamicCostUsd() > 0, "API Gateway should incur dynamic request costs");
    }
}
