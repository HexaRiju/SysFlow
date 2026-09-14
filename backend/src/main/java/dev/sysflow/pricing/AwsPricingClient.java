package dev.sysflow.pricing;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * AWS pricing provider for SysFlow.
 * Uses verified standard pricing for us-east-1 (N. Virginia), providing both
 * provisioned instance rates and dynamic traffic/request rates.
 */
@Component
public class AwsPricingClient implements CloudPricingProvider {

    private static final Logger log = LoggerFactory.getLogger(AwsPricingClient.class);

    private static final Map<ScaleTier, SkuPrice> COMPUTE_PRICES = Map.of(
            ScaleTier.XS_2GB, new SkuPrice(0.0208, "t3.small", "AWS EC2 t3.small (2 vCPU, 2 GiB)"),
            ScaleTier.SM_4GB, new SkuPrice(0.0416, "t3.medium", "AWS EC2 t3.medium (2 vCPU, 4 GiB)"),
            ScaleTier.MD_8GB, new SkuPrice(0.0960, "m5.large", "AWS EC2 m5.large (2 vCPU, 8 GiB)"),
            ScaleTier.LG_16GB, new SkuPrice(0.1920, "m5.xlarge", "AWS EC2 m5.xlarge (4 vCPU, 16 GiB)"),
            ScaleTier.XL_32GB, new SkuPrice(0.3840, "m5.2xlarge", "AWS EC2 m5.2xlarge (8 vCPU, 32 GiB)")
    );

    private static final Map<ScaleTier, SkuPrice> DATABASE_PRICES = Map.of(
            ScaleTier.XS_2GB, new SkuPrice(0.0170, "db.t3.micro", "RDS PostgreSQL db.t3.micro"),
            ScaleTier.SM_4GB, new SkuPrice(0.0680, "db.t3.medium", "RDS PostgreSQL db.t3.medium"),
            ScaleTier.MD_8GB, new SkuPrice(0.1790, "db.m5.large", "RDS PostgreSQL db.m5.large"),
            ScaleTier.LG_16GB, new SkuPrice(0.3580, "db.m5.xlarge", "RDS PostgreSQL db.m5.xlarge"),
            ScaleTier.XL_32GB, new SkuPrice(0.7160, "db.m5.2xlarge", "RDS PostgreSQL db.m5.2xlarge")
    );

    private static final Map<ScaleTier, SkuPrice> CACHE_PRICES = Map.of(
            ScaleTier.XS_2GB, new SkuPrice(0.0340, "cache.t3.small", "ElastiCache Redis cache.t3.small"),
            ScaleTier.SM_4GB, new SkuPrice(0.0680, "cache.t3.medium", "ElastiCache Redis cache.t3.medium"),
            ScaleTier.MD_8GB, new SkuPrice(0.1360, "cache.m5.large", "ElastiCache Redis cache.m5.large"),
            ScaleTier.LG_16GB, new SkuPrice(0.2720, "cache.m5.xlarge", "ElastiCache Redis cache.m5.xlarge"),
            ScaleTier.XL_32GB, new SkuPrice(0.5440, "cache.m5.2xlarge", "ElastiCache Redis cache.m5.2xlarge")
    );

    @Override
    public String providerId() {
        return "aws";
    }

    @Override
    public String providerName() {
        return "Amazon Web Services";
    }

    @Override
    public String defaultRegion() {
        return "us-east-1";
    }

    @Override
    public Optional<Double> hourlyComputePrice(ScaleTier tier) {
        return Optional.ofNullable(COMPUTE_PRICES.get(tier)).map(SkuPrice::hourlyUsd);
    }

    @Override
    public String computeSkuLabel(ScaleTier tier) {
        SkuPrice price = COMPUTE_PRICES.get(tier);
        return price != null ? price.skuName() : "t3.medium";
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
        return price != null ? price.skuName() : "db.t3.medium";
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
        return price != null ? price.skuName() : "cache.t3.medium";
    }

    @Override
    public Map<ScaleTier, SkuPrice> allCachePrices() {
        return CACHE_PRICES;
    }

    @Override
    public Optional<Double> monthlyStorageCostPerGb() {
        return Optional.of(0.023); // Amazon S3 Standard ($0.023 / GB-month)
    }

    @Override
    public String storageSkuLabel() {
        return "S3 Standard";
    }

    @Override
    public Optional<Double> hourlyLoadBalancerPrice() {
        return Optional.of(0.0225); // Application Load Balancer ($0.0225 / hr)
    }

    @Override
    public String loadBalancerSkuLabel() {
        return "Application Load Balancer";
    }

    @Override
    public Optional<Double> pricePerMillionRequests(String componentType) {
        return switch (componentType) {
            case "apiGateway" -> Optional.of(1.00); // AWS HTTP API Gateway ($1.00 per 1M)
            case "queue" -> Optional.of(0.40); // Amazon SQS Standard ($0.40 per 1M)
            case "serverless" -> Optional.of(0.20); // AWS Lambda invocations ($0.20 per 1M)
            case "eventBus" -> Optional.of(1.00); // Amazon EventBridge custom events ($1.00 per 1M)
            case "waf" -> Optional.of(0.60); // AWS WAF ($0.60 per 1M requests)
            default -> Optional.empty();
        };
    }

    @Override
    public double egressPricePerGb() {
        return 0.090; // AWS Internet Egress ($0.09 / GB)
    }
}
