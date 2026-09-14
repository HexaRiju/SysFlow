package dev.sysflow.pricing.dto;

import java.util.List;
import java.util.Map;

public record PricingCompareResponse(
        Map<String, ProviderCostSummary> providers,
        String bestValueProvider,
        double maxMonthlySavingsUsd,
        DynamicUsageMetrics dynamicMetrics,
        List<String> recommendations
) {
    public record ProviderCostSummary(
            String providerId,
            String providerName,
            String region,
            double totalMonthlyCostUsd,
            double provisionedCostUsd,
            double dynamicCostUsd,
            double egressCostUsd,
            double cacheSavingsUsd,
            List<NodeCostDetail> nodes
    ) {}

    public record NodeCostDetail(
            String id,
            String type,
            double monthlyCostUsd,
            String source,
            String note
    ) {}

    public record DynamicUsageMetrics(
            double simulatedRps,
            double monthlyRequestsMillions,
            double monthlyEgressGb,
            double cacheHitRatePct
    ) {}
}
