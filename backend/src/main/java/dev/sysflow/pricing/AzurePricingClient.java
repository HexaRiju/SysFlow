package dev.sysflow.pricing;

import com.fasterxml.jackson.databind.JsonNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Real hourly prices from Azure's public Retail Prices API.
 * Region fixed to eastus for a single consistent baseline.
 */
@Component
public class AzurePricingClient implements CloudPricingProvider {

    private static final Logger log = LoggerFactory.getLogger(AzurePricingClient.class);
    private static final double HOURS_PER_MONTH = 730;
    private static final Duration CACHE_TTL = Duration.ofHours(24);

    private final RestClient restClient = buildRestClient();

    private static RestClient buildRestClient() {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(5_000);
        requestFactory.setReadTimeout(10_000);
        return RestClient.builder()
                .baseUrl("https://prices.azure.com/api/retail/prices")
                .requestFactory(requestFactory)
                .build();
    }

    private final Map<PricingCategory, CachedPrice> cache = new ConcurrentHashMap<>();

    private record CachedPrice(double hourlyUsd, Instant fetchedAt) {
        boolean isFresh() {
            return Instant.now().isBefore(fetchedAt.plus(CACHE_TTL));
        }
    }

    public enum PricingCategory {
        GENERIC_COMPUTE_XS_2GB("armRegionName eq 'eastus' and serviceName eq 'Virtual Machines' and armSkuName eq 'Standard_B1ms' and priceType eq 'Consumption'", "Virtual Machines BS Series", null),
        GENERIC_COMPUTE_SM_4GB("armRegionName eq 'eastus' and serviceName eq 'Virtual Machines' and armSkuName eq 'Standard_B2s' and priceType eq 'Consumption'", "Virtual Machines BS Series", null),
        GENERIC_COMPUTE_MD_8GB("armRegionName eq 'eastus' and serviceName eq 'Virtual Machines' and armSkuName eq 'Standard_D2s_v3' and priceType eq 'Consumption'", "Virtual Machines DSv3 Series", "D2s v3"),
        GENERIC_COMPUTE_LG_16GB("armRegionName eq 'eastus' and serviceName eq 'Virtual Machines' and armSkuName eq 'Standard_D4s_v3' and priceType eq 'Consumption'", "Virtual Machines DSv3 Series", "D4s v3"),
        GENERIC_COMPUTE_XL_32GB("armRegionName eq 'eastus' and serviceName eq 'Virtual Machines' and armSkuName eq 'Standard_D8s_v3' and priceType eq 'Consumption'", "Virtual Machines DSv3 Series", "D8s v3"),

        MANAGED_DATABASE_XS_2GB("armRegionName eq 'eastus' and serviceName eq 'Azure Database for PostgreSQL' and skuName eq 'B1ms'", "Burstable BS Series", null),
        MANAGED_DATABASE_SM_4GB("armRegionName eq 'eastus' and serviceName eq 'Azure Database for PostgreSQL' and skuName eq 'B2ms'", "Burstable BS Series", null),
        MANAGED_DATABASE_MD_8GB("armRegionName eq 'eastus' and serviceName eq 'Azure Database for PostgreSQL' and skuName eq 'B4ms'", "Burstable BS Series", null),
        MANAGED_DATABASE_LG_16GB("armRegionName eq 'eastus' and serviceName eq 'Azure Database for PostgreSQL' and skuName eq 'D2ds_v4'", "General Purpose Ddsv4 Series", null),
        MANAGED_DATABASE_XL_32GB("armRegionName eq 'eastus' and serviceName eq 'Azure Database for PostgreSQL' and skuName eq 'D4ds_v4'", "General Purpose Ddsv4 Series", null),

        CACHE_XS_2GB("armRegionName eq 'eastus' and serviceName eq 'Redis Cache' and skuName eq 'C0'", "Azure Redis Cache Basic", null),
        CACHE_SM_4GB("armRegionName eq 'eastus' and serviceName eq 'Redis Cache' and skuName eq 'C1'", "Azure Redis Cache Basic", null),
        CACHE_MD_8GB("armRegionName eq 'eastus' and serviceName eq 'Redis Cache' and skuName eq 'C2'", "Azure Redis Cache Basic", null),
        CACHE_LG_16GB("armRegionName eq 'eastus' and serviceName eq 'Redis Cache' and skuName eq 'C3'", "Azure Redis Cache Basic", null),
        CACHE_XL_32GB("armRegionName eq 'eastus' and serviceName eq 'Redis Cache' and skuName eq 'C4'", "Azure Redis Cache Basic", null),

        OBJECT_STORAGE("armRegionName eq 'eastus' and serviceName eq 'Storage' and skuName eq 'Hot LRS' and meterName eq 'Hot LRS Data Stored'", "Blob Storage", null);

        final String filter;
        final String productNameMatch;
        final String exactMeterName;

        PricingCategory(String filter, String productNameMatch, String exactMeterName) {
            this.filter = filter;
            this.productNameMatch = productNameMatch;
            this.exactMeterName = exactMeterName;
        }
    }

    public static PricingCategory computeCategoryFor(ScaleTier tier) {
        return switch (tier) {
            case XS_2GB -> PricingCategory.GENERIC_COMPUTE_XS_2GB;
            case SM_4GB -> PricingCategory.GENERIC_COMPUTE_SM_4GB;
            case MD_8GB -> PricingCategory.GENERIC_COMPUTE_MD_8GB;
            case LG_16GB -> PricingCategory.GENERIC_COMPUTE_LG_16GB;
            case XL_32GB -> PricingCategory.GENERIC_COMPUTE_XL_32GB;
        };
    }

    public static PricingCategory databaseCategoryFor(ScaleTier tier) {
        return switch (tier) {
            case XS_2GB -> PricingCategory.MANAGED_DATABASE_XS_2GB;
            case SM_4GB -> PricingCategory.MANAGED_DATABASE_SM_4GB;
            case MD_8GB -> PricingCategory.MANAGED_DATABASE_MD_8GB;
            case LG_16GB -> PricingCategory.MANAGED_DATABASE_LG_16GB;
            case XL_32GB -> PricingCategory.MANAGED_DATABASE_XL_32GB;
        };
    }

    public static PricingCategory cacheCategoryFor(ScaleTier tier) {
        return switch (tier) {
            case XS_2GB -> PricingCategory.CACHE_XS_2GB;
            case SM_4GB -> PricingCategory.CACHE_SM_4GB;
            case MD_8GB -> PricingCategory.CACHE_MD_8GB;
            case LG_16GB -> PricingCategory.CACHE_LG_16GB;
            case XL_32GB -> PricingCategory.CACHE_XL_32GB;
        };
    }

    public Optional<Double> hourlyPriceUsd(PricingCategory category) {
        CachedPrice cached = cache.get(category);
        if (cached != null && cached.isFresh()) {
            return Optional.of(cached.hourlyUsd);
        }
        return fetch(category).map(price -> {
            cache.put(category, new CachedPrice(price, Instant.now()));
            return price;
        }).or(() -> cached != null ? Optional.of(cached.hourlyUsd) : Optional.empty());
    }

    public Optional<Double> monthlyPriceUsd(PricingCategory category) {
        return hourlyPriceUsd(category).map(hourly -> hourly * HOURS_PER_MONTH);
    }

    public Optional<Double> monthlyStorageCostUsd(double assumedGb) {
        return hourlyPriceUsd(PricingCategory.OBJECT_STORAGE).map(perGbMonth -> perGbMonth * assumedGb);
    }

    private Optional<Double> fetch(PricingCategory category) {
        try {
            JsonNode response = restClient.get()
                    .uri(uriBuilder -> uriBuilder.queryParam("$filter", category.filter).build())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null) return Optional.empty();
            for (JsonNode item : response.path("Items")) {
                boolean productMatches = item.path("productName").asText("").contains(category.productNameMatch);
                boolean meterMatches = category.exactMeterName == null || category.exactMeterName.equals(item.path("meterName").asText(""));
                if (productMatches && meterMatches) {
                    return Optional.of(item.path("retailPrice").asDouble());
                }
            }
            JsonNode items = response.path("Items");
            if (items.isArray() && items.size() > 0) {
                return Optional.of(items.get(0).path("retailPrice").asDouble());
            }
            return Optional.empty();
        } catch (Exception e) {
            log.warn("Azure pricing lookup failed for {}: {}", category, e.getMessage());
            return Optional.empty();
        }
    }

    @Override
    public String providerId() {
        return "azure";
    }

    @Override
    public String providerName() {
        return "Microsoft Azure";
    }

    @Override
    public String defaultRegion() {
        return "eastus";
    }

    @Override
    public Optional<Double> hourlyComputePrice(ScaleTier tier) {
        return hourlyPriceUsd(computeCategoryFor(tier));
    }

    @Override
    public String computeSkuLabel(ScaleTier tier) {
        return switch (tier) {
            case XS_2GB -> "Standard_B1ms";
            case SM_4GB -> "Standard_B2s";
            case MD_8GB -> "Standard_D2s_v3";
            case LG_16GB -> "Standard_D4s_v3";
            case XL_32GB -> "Standard_D8s_v3";
        };
    }

    @Override
    public Map<ScaleTier, SkuPrice> allComputePrices() {
        Map<ScaleTier, SkuPrice> map = new EnumMap<>(ScaleTier.class);
        for (ScaleTier tier : ScaleTier.values()) {
            hourlyComputePrice(tier).ifPresent(price -> 
                map.put(tier, new SkuPrice(price, computeSkuLabel(tier), "Azure Linux VM (" + tier.label() + ")")));
        }
        return map;
    }

    @Override
    public Optional<Double> hourlyDatabasePrice(ScaleTier tier) {
        return hourlyPriceUsd(databaseCategoryFor(tier));
    }

    @Override
    public String databaseSkuLabel(ScaleTier tier) {
        return switch (tier) {
            case XS_2GB -> "Burstable B1ms";
            case SM_4GB -> "Burstable B2ms";
            case MD_8GB -> "Burstable B4ms";
            case LG_16GB -> "General Purpose D2ds_v4";
            case XL_32GB -> "General Purpose D4ds_v4";
        };
    }

    @Override
    public Map<ScaleTier, SkuPrice> allDatabasePrices() {
        Map<ScaleTier, SkuPrice> map = new EnumMap<>(ScaleTier.class);
        for (ScaleTier tier : ScaleTier.values()) {
            hourlyDatabasePrice(tier).ifPresent(price -> 
                map.put(tier, new SkuPrice(price, databaseSkuLabel(tier), "Azure Database for PostgreSQL (" + tier.label() + ")")));
        }
        return map;
    }

    @Override
    public Optional<Double> hourlyCachePrice(ScaleTier tier) {
        return hourlyPriceUsd(cacheCategoryFor(tier));
    }

    @Override
    public String cacheSkuLabel(ScaleTier tier) {
        return switch (tier) {
            case XS_2GB -> "Basic C0";
            case SM_4GB -> "Basic C1";
            case MD_8GB -> "Basic C2";
            case LG_16GB -> "Basic C3";
            case XL_32GB -> "Basic C4";
        };
    }

    @Override
    public Map<ScaleTier, SkuPrice> allCachePrices() {
        Map<ScaleTier, SkuPrice> map = new EnumMap<>(ScaleTier.class);
        for (ScaleTier tier : ScaleTier.values()) {
            hourlyCachePrice(tier).ifPresent(price -> 
                map.put(tier, new SkuPrice(price, cacheSkuLabel(tier), "Azure Cache for Redis (" + tier.label() + ")")));
        }
        return map;
    }

    @Override
    public Optional<Double> monthlyStorageCostPerGb() {
        return hourlyPriceUsd(PricingCategory.OBJECT_STORAGE);
    }

    @Override
    public String storageSkuLabel() {
        return "Blob Storage Hot LRS";
    }

    @Override
    public Optional<Double> hourlyLoadBalancerPrice() {
        return Optional.of(0.025); // Standard Load Balancer rule/hr baseline
    }

    @Override
    public String loadBalancerSkuLabel() {
        return "Standard Load Balancer";
    }

    @Override
    public Optional<Double> pricePerMillionRequests(String componentType) {
        return switch (componentType) {
            case "apiGateway" -> Optional.of(3.50);
            case "queue" -> Optional.of(0.40);
            case "serverless" -> Optional.of(0.20);
            case "eventBus" -> Optional.of(0.60);
            case "waf" -> Optional.of(0.60);
            default -> Optional.empty();
        };
    }

    @Override
    public double egressPricePerGb() {
        return 0.087; // Azure standard Internet egress rate
    }
}
