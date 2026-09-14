package dev.sysflow.pricing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Optional;

/**
 * Google Cloud Platform (GCP) pricing provider for SysFlow.
 * Uses verified standard pricing for us-central1 (Iowa), providing both
 * provisioned instance rates and dynamic traffic/request rates.
 */
@Component
public class GcpPricingClient implements CloudPricingProvider {

    private static final Logger log = LoggerFactory.getLogger(GcpPricingClient.class);

    private static final Map<ScaleTier, SkuPrice> COMPUTE_PRICES = Map.of(
            ScaleTier.XS_2GB, new SkuPrice(0.0167, "e2-small", "GCP Compute e2-small (2 vCPU, 2 GiB)"),
            ScaleTier.SM_4GB, new SkuPrice(0.0335, "e2-medium", "GCP Compute e2-medium (2 vCPU, 4 GiB)"),
            ScaleTier.MD_8GB, new SkuPrice(0.0670, "e2-standard-2", "GCP Compute e2-standard-2 (2 vCPU, 8 GiB)"),
            ScaleTier.LG_16GB, new SkuPrice(0.1340, "e2-standard-4", "GCP Compute e2-standard-4 (4 vCPU, 16 GiB)"),
            ScaleTier.XL_32GB, new SkuPrice(0.2680, "e2-standard-8", "GCP Compute e2-standard-8 (8 vCPU, 32 GiB)")
    );

    private static final Map<ScaleTier, SkuPrice> DATABASE_PRICES = Map.of(
            ScaleTier.XS_2GB, new SkuPrice(0.0350, "db-custom-1-3840", "Cloud SQL PostgreSQL db-custom-1-3840"),
            ScaleTier.SM_4GB, new SkuPrice(0.0820, "db-custom-2-7680", "Cloud SQL PostgreSQL db-custom-2-7680"),
            ScaleTier.MD_8GB, new SkuPrice(0.1640, "db-custom-4-15360", "Cloud SQL PostgreSQL db-custom-4-15360"),
            ScaleTier.LG_16GB, new SkuPrice(0.3280, "db-custom-8-30720", "Cloud SQL PostgreSQL db-custom-8-30720"),
            ScaleTier.XL_32GB, new SkuPrice(0.6560, "db-custom-16-61440", "Cloud SQL PostgreSQL db-custom-16-61440")
    );

    private static final Map<ScaleTier, SkuPrice> CACHE_PRICES = Map.of(
            ScaleTier.XS_2GB, new SkuPrice(0.0490, "Memorystore 2GB", "Memorystore Redis Basic 2GB"),
            ScaleTier.SM_4GB, new SkuPrice(0.0980, "Memorystore 4GB", "Memorystore Redis Basic 4GB"),
            ScaleTier.MD_8GB, new SkuPrice(0.1960, "Memorystore 8GB", "Memorystore Redis Basic 8GB"),
            ScaleTier.LG_16GB, new SkuPrice(0.3920, "Memorystore 16GB", "Memorystore Redis Basic 16GB"),
            ScaleTier.XL_32GB, new SkuPrice(0.7840, "Memorystore 32GB", "Memorystore Redis Basic 32GB")
    );

    @Override
    public String providerId() {
        return "gcp";
    }

    @Override
    public String providerName() {
        return "Google Cloud Platform";
    }

    @Override
    public String defaultRegion() {
        return "us-central1";
    }

    @Override
    public Optional<Double> hourlyComputePrice(ScaleTier tier) {
        return Optional.ofNullable(COMPUTE_PRICES.get(tier)).map(SkuPrice::hourlyUsd);
    }

    @Override
    public String computeSkuLabel(ScaleTier tier) {
        SkuPrice price = COMPUTE_PRICES.get(tier);
        return price != null ? price.skuName() : "e2-medium";
    }

    @Override
    public Map<ScaleTier, SkuPrice> allComputePrices() {
        return COMPUTE_PRICES;
    }

    @Override
    public Optional<Double> hourlyDatabasePrice(ScaleTier tier) {
        return Optional.ofNullable(DATABASE_PRICES.get(tier)).map(SkuPrice::hourlyUsd);
    }

    @Override
    public String databaseSkuLabel(ScaleTier tier) {
        SkuPrice price = DATABASE_PRICES.get(tier);
        return price != null ? price.skuName() : "db-custom-2-7680";
    }

    @Override
    public Map<ScaleTier, SkuPrice> allDatabasePrices() {
        return DATABASE_PRICES;
    }

    @Override
    public Optional<Double> hourlyCachePrice(ScaleTier tier) {
        return Optional.ofNullable(CACHE_PRICES.get(tier)).map(SkuPrice::hourlyUsd);
    }

    @Override
    public String cacheSkuLabel(ScaleTier tier) {
        SkuPrice price = CACHE_PRICES.get(tier);
        return price != null ? price.skuName() : "Memorystore 4GB";
    }

    @Override
    public Map<ScaleTier, SkuPrice> allCachePrices() {
        return CACHE_PRICES;
    }

    @Override
    public Optional<Double> monthlyStorageCostPerGb() {
        return Optional.of(0.020); // Google Cloud Storage Standard ($0.020 / GB-month)
    }

    @Override
    public String storageSkuLabel() {
        return "Cloud Storage Standard";
    }

    @Override
    public Optional<Double> hourlyLoadBalancerPrice() {
        return Optional.of(0.0250); // Cloud Load Balancing ($0.025 / hr)
    }

    @Override
    public String loadBalancerSkuLabel() {
        return "Cloud Load Balancing";
    }

    @Override
    public Optional<Double> pricePerMillionRequests(String componentType) {
        return switch (componentType) {
            case "apiGateway" -> Optional.of(3.00); // GCP API Gateway ($3.00 per 1M)
            case "queue" -> Optional.of(0.40); // Cloud Pub/Sub ($0.40 per 1M)
            case "serverless" -> Optional.of(0.40); // Cloud Functions ($0.40 per 1M)
            case "eventBus" -> Optional.of(0.60); // Eventarc ($0.60 per 1M)
            case "waf" -> Optional.of(0.75); // Cloud Armor ($0.75 per 1M requests)
            default -> Optional.empty();
        };
    }

    @Override
    public double egressPricePerGb() {
        return 0.085; // GCP Internet Egress ($0.085 / GB)
    }
}
