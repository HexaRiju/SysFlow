package dev.sysflow.pricing;

import java.util.Map;
import java.util.Optional;

/**
 * Common contract for cloud pricing providers (AWS, GCP, Azure).
 * Supplies both fixed provisioned instance rates and variable traffic/consumption rates.
 */
public interface CloudPricingProvider {

    String providerId();

    String providerName();

    String defaultRegion();

    Optional<Double> hourlyComputePrice(ScaleTier tier);

    String computeSkuLabel(ScaleTier tier);
    
    Map<ScaleTier, SkuPrice> allComputePrices();

    Optional<Double> hourlyDatabasePrice(ScaleTier tier);

    String databaseSkuLabel(ScaleTier tier);
    
    Map<ScaleTier, SkuPrice> allDatabasePrices();

    Optional<Double> hourlyCachePrice(ScaleTier tier);

    String cacheSkuLabel(ScaleTier tier);
    
    Map<ScaleTier, SkuPrice> allCachePrices();

    Optional<Double> monthlyStorageCostPerGb();

    String storageSkuLabel();

    Optional<Double> hourlyLoadBalancerPrice();

    String loadBalancerSkuLabel();

    Optional<Double> pricePerMillionRequests(String componentType);

    double egressPricePerGb();
}
