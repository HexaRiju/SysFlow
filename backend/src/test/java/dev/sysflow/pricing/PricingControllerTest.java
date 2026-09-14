package dev.sysflow.pricing;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * AzurePricingClient is mocked here deliberately — hitting the real Azure API from a test
 * would make CI flaky and slow, and the numbers can drift over time. What's actually worth
 * locking in as a test is PricingController's own logic: which types get a real-pricing
 * attempt, the fallback to illustrative when unavailable, and that the total is the sum of
 * the per-node costs — none of that needs a live price to verify.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PricingControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AzurePricingClient pricingClient;

    @Test
    void usesRealPriceWhenAvailableForMappedType() throws Exception {
        when(pricingClient.monthlyPriceUsd(AzurePricingClient.PricingCategory.GENERIC_COMPUTE_XS_2GB))
                .thenReturn(Optional.of(30.0));

        Map<String, Object> body = Map.of("graphJson", Map.of(
                "nodes", List.of(Map.of("id", "svc", "type", "service", "config", Map.of()))
        ));

        mockMvc.perform(post("/api/pricing/estimate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[0].source").value("real"))
                .andExpect(jsonPath("$.nodes[0].monthlyCostUsd").value(30.0))
                .andExpect(jsonPath("$.totalMonthlyCostUsd").value(30.0));
    }

    @Test
    void fallsBackToIllustrativeWhenRealLookupUnavailable() throws Exception {
        when(pricingClient.monthlyPriceUsd(any())).thenReturn(Optional.empty());

        Map<String, Object> body = Map.of("graphJson", Map.of(
                "nodes", List.of(Map.of("id", "svc", "type", "service", "config", Map.of()))
        ));

        mockMvc.perform(post("/api/pricing/estimate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[0].source").value("illustrative"));
    }

    @Test
    void typeWithNoRealMappingIsAlwaysIllustrative() throws Exception {
        Map<String, Object> body = Map.of("graphJson", Map.of(
                "nodes", List.of(Map.of("id", "lb", "type", "loadBalancer", "config", Map.of()))
        ));

        mockMvc.perform(post("/api/pricing/estimate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[0].source").value("illustrative"))
                .andExpect(jsonPath("$.nodes[0].monthlyCostUsd").value(18.0));
    }

    @Test
    void picksLargerSkuTierForHighlyConfiguredCompute() throws Exception {
        when(pricingClient.monthlyPriceUsd(AzurePricingClient.PricingCategory.GENERIC_COMPUTE_XL_32GB))
                .thenReturn(Optional.of(140.0));

        Map<String, Object> body = Map.of("graphJson", Map.of(
                "nodes", List.of(Map.of("id", "svc", "type", "service", "config", Map.of("maxConcurrency", 5000)))
        ));

        mockMvc.perform(post("/api/pricing/estimate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nodes[0].source").value("real"))
                .andExpect(jsonPath("$.nodes[0].monthlyCostUsd").value(140.0))
                .andExpect(jsonPath("$.nodes[0].note", org.hamcrest.Matchers.containsString("D8s_v3")));
    }

    @Test
    void totalIsSumOfPerNodeCosts() throws Exception {
        when(pricingClient.monthlyPriceUsd(AzurePricingClient.PricingCategory.GENERIC_COMPUTE_XS_2GB))
                .thenReturn(Optional.of(30.0));

        Map<String, Object> body = Map.of("graphJson", Map.of(
                "nodes", List.of(
                        Map.of("id", "svc", "type", "service", "config", Map.of()),
                        Map.of("id", "lb", "type", "loadBalancer", "config", Map.of())
                )
        ));

        mockMvc.perform(post("/api/pricing/estimate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalMonthlyCostUsd").value(48.0)); // 30 (real svc) + 18 (illustrative lb)
    }

    @Test
    void compareReturnsMultiCloudEstimatesAndRecommendations() throws Exception {
        when(pricingClient.providerId()).thenReturn("azure");
        when(pricingClient.providerName()).thenReturn("Microsoft Azure");
        when(pricingClient.defaultRegion()).thenReturn("eastus");

        Map<String, Object> body = Map.of(
                "graphJson", Map.of(
                        "nodes", List.of(Map.of("id", "svc", "type", "service", "config", Map.of())),
                        "edges", List.of()
                ),
                "targetRps", 150.0
        );

        mockMvc.perform(post("/api/pricing/compare")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.providers.aws.providerId").value("aws"))
                .andExpect(jsonPath("$.providers.gcp.providerId").value("gcp"))
                .andExpect(jsonPath("$.providers.azure.providerId").value("azure"))
                .andExpect(jsonPath("$.bestValueProvider").isNotEmpty())
                .andExpect(jsonPath("$.dynamicMetrics.simulatedRps").value(150.0));
    }
}
