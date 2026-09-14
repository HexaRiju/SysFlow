package dev.sysflow.pricing;

import dev.sysflow.common.CostModel;
import dev.sysflow.pricing.dto.PricingCompareRequest;
import dev.sysflow.pricing.dto.PricingCompareResponse;
import dev.sysflow.pricing.dto.PricingEstimateRequest;
import dev.sysflow.pricing.dto.PricingEstimateResponse;
import dev.sysflow.pricing.dto.ScalePricingResponse;
import dev.sysflow.simulation.model.GraphNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Pricing API:
 * - POST /api/pricing/estimate — real Azure Retail Prices with illustrative fallback (legacy)
 * - POST /api/pricing/compare — full multi-cloud end-to-end pricing pipeline (AWS, GCP, Azure)
 *   with both provisioned instance costs and dynamic simulation-derived traffic/egress costs.
 */
@RestController
@RequestMapping("/api/pricing")
public class PricingController {

    /** Assumed data volume for object storage nodes — storage is priced per GB/month, not per instance. */
    private static final double ASSUMED_STORAGE_GB = 100;

    private static final Set<String> GENERIC_COMPUTE_TYPES = Set.of(
            "service", "worker", "serverless", "cronJob", "autoScalingGroup", "containerOrchestrator");
    private static final Set<String> MANAGED_DATABASE_TYPES = Set.of(
            "database", "dataWarehouse", "searchIndex", "dataLake");

    private final CostModel costModel;
    private final AzurePricingClient pricingClient;
    private final EndToEndCostPipeline endToEndPipeline;

    public PricingController(CostModel costModel, AzurePricingClient pricingClient, EndToEndCostPipeline endToEndPipeline) {
        this.costModel = costModel;
        this.pricingClient = pricingClient;
        this.endToEndPipeline = endToEndPipeline;
    }

    @PostMapping("/compare")
    public PricingCompareResponse compare(@RequestBody PricingCompareRequest request) {
        return endToEndPipeline.compare(request);
    }

    @PostMapping("/estimate")
    public PricingEstimateResponse estimate(@RequestBody PricingEstimateRequest request) {
        List<PricingEstimateResponse.NodeCost> nodeCosts = request.graphJson().nodes().stream()
                .map(this::costOf)
                .toList();
        double total = nodeCosts.stream().mapToDouble(PricingEstimateResponse.NodeCost::monthlyCostUsd).sum();
        return new PricingEstimateResponse(total, "azure", "eastus", nodeCosts);
    }

    @GetMapping("/scale-tiers")
    public ScalePricingResponse getScaleTiers() {
        Map<String, ScalePricingResponse.ProviderScalePricing> providersMap = new java.util.LinkedHashMap<>();
        
        for (CloudPricingProvider provider : List.of(new AwsPricingClient(), new GcpPricingClient(), pricingClient)) {
            Map<String, ScalePricingResponse.CategoryPricing> categories = new java.util.LinkedHashMap<>();
            
            categories.put("compute", mapCategory(provider.allComputePrices()));
            categories.put("database", mapCategory(provider.allDatabasePrices()));
            categories.put("cache", mapCategory(provider.allCachePrices()));
            
            providersMap.put(provider.providerId(), new ScalePricingResponse.ProviderScalePricing(
                    provider.providerId(), provider.providerName(), provider.defaultRegion(), categories
            ));
        }
        return new ScalePricingResponse(providersMap);
    }

    private ScalePricingResponse.CategoryPricing mapCategory(Map<ScaleTier, SkuPrice> prices) {
        Map<String, ScalePricingResponse.TierPrice> tiers = new java.util.LinkedHashMap<>();
        for (Map.Entry<ScaleTier, SkuPrice> entry : prices.entrySet()) {
            SkuPrice p = entry.getValue();
            tiers.put(entry.getKey().label(), new ScalePricingResponse.TierPrice(
                    p.hourlyUsd(), p.hourlyUsd() * 730.0, p.skuName(), p.description()
            ));
        }
        return new ScalePricingResponse.CategoryPricing(tiers);
    }

    private ScaleTier tierFor(double configuredSize, double mediumMax, double largeMax) {
        if (configuredSize <= mediumMax * 0.5) return ScaleTier.XS_2GB;
        if (configuredSize <= mediumMax) return ScaleTier.SM_4GB;
        if (configuredSize <= largeMax * 0.5) return ScaleTier.MD_8GB;
        if (configuredSize <= largeMax) return ScaleTier.LG_16GB;
        return ScaleTier.XL_32GB;
    }

    private static final Map<ScaleTier, String> COMPUTE_SKU_LABEL = Map.of(
            ScaleTier.XS_2GB, "Standard_B1ms",
            ScaleTier.SM_4GB, "Standard_B2s",
            ScaleTier.MD_8GB, "Standard_D2s_v3",
            ScaleTier.LG_16GB, "Standard_D4s_v3",
            ScaleTier.XL_32GB, "Standard_D8s_v3");
    private static final Map<ScaleTier, String> DATABASE_SKU_LABEL = Map.of(
            ScaleTier.XS_2GB, "Burstable B1ms",
            ScaleTier.SM_4GB, "Burstable B2ms",
            ScaleTier.MD_8GB, "Burstable B4ms",
            ScaleTier.LG_16GB, "General Purpose D2ds_v4",
            ScaleTier.XL_32GB, "General Purpose D4ds_v4");
    private static final Map<ScaleTier, String> CACHE_SKU_LABEL = Map.of(
            ScaleTier.XS_2GB, "Basic C0",
            ScaleTier.SM_4GB, "Basic C1",
            ScaleTier.MD_8GB, "Basic C2",
            ScaleTier.LG_16GB, "Basic C3",
            ScaleTier.XL_32GB, "Basic C4");

    private ScaleTier parseScale(String scale, double configuredSize, double mediumMax, double largeMax) {
        if (scale == null || "Auto".equals(scale) || scale.isBlank()) {
            return tierFor(configuredSize, mediumMax, largeMax);
        }
        try {
            return ScaleTier.valueOf(scale);
        } catch (IllegalArgumentException e) {
            return tierFor(configuredSize, mediumMax, largeMax);
        }
    }

    private PricingEstimateResponse.NodeCost costOf(PricingEstimateRequest.NodeJson n) {
        GraphNode node = new GraphNode(n.id(), n.type(), n.config());
        int units = costModel.unitsOf(node);
        String explicitScale = node.getString("scale", "Auto");

        if (GENERIC_COMPUTE_TYPES.contains(n.type())) {
            double configuredSize = Math.max(node.getNumber("maxConcurrency", 0), node.getNumber("maxThroughput", 0));
            var tier = parseScale(explicitScale, configuredSize, 800, 3000);
            var real = pricingClient.monthlyPriceUsd(AzurePricingClient.computeCategoryFor(tier));
            if (real.isPresent()) {
                return new PricingEstimateResponse.NodeCost(n.id(), n.type(), real.get() * units, "real",
                        "Azure " + COMPUTE_SKU_LABEL.get(tier) + " Linux VM as a stand-in for generic compute (sized from configured concurrency/throughput)");
            }
        } else if (MANAGED_DATABASE_TYPES.contains(n.type())) {
            double configuredSize = node.getNumber("maxConnections", 0);
            var tier = parseScale(explicitScale, configuredSize, 100, 500);
            var real = pricingClient.monthlyPriceUsd(AzurePricingClient.databaseCategoryFor(tier));
            if (real.isPresent()) {
                return new PricingEstimateResponse.NodeCost(n.id(), n.type(), real.get() * units, "real",
                        "Azure Database for PostgreSQL Flexible Server (" + DATABASE_SKU_LABEL.get(tier) + ") as a stand-in for managed data stores (sized from configured max connections)");
            }
        } else if ("cache".equals(n.type())) {
            double configuredSize = node.getNumber("maxThroughput", node.getNumber("maxConnections", 0));
            var tier = parseScale(explicitScale, configuredSize, 1000, 5000);
            var real = pricingClient.monthlyPriceUsd(AzurePricingClient.cacheCategoryFor(tier));
            if (real.isPresent()) {
                return new PricingEstimateResponse.NodeCost(n.id(), n.type(), real.get() * units, "real",
                        "Azure Cache for Redis, " + CACHE_SKU_LABEL.get(tier) + " (sized from configured throughput)");
            }
        } else if ("objectStorage".equals(n.type())) {
            var real = pricingClient.monthlyStorageCostUsd(ASSUMED_STORAGE_GB);
            if (real.isPresent()) {
                return new PricingEstimateResponse.NodeCost(n.id(), n.type(), real.get() * units, "real",
                        "Azure Blob Storage, Hot LRS, assuming " + (int) ASSUMED_STORAGE_GB + "GB stored");
            }
        }

        return new PricingEstimateResponse.NodeCost(n.id(), n.type(), costModel.monthlyCostOf(node), "illustrative",
                "No verified real-pricing mapping for this component type");
    }
}
