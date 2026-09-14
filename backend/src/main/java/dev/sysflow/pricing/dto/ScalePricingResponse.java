package dev.sysflow.pricing.dto;

import java.util.Map;

public record ScalePricingResponse(
        Map<String, ProviderScalePricing> providers
) {
    public record ProviderScalePricing(
            String providerId,
            String providerName,
            String region,
            Map<String, CategoryPricing> categories
    ) {}

    public record CategoryPricing(
            Map<String, TierPrice> tiers
    ) {}

    public record TierPrice(
            double hourlyUsd,
            double monthlyUsd,
            String skuName,
            String description
    ) {}
}
