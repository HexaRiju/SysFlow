package dev.sysflow.pricing;

import dev.sysflow.common.CostModel;
import dev.sysflow.pricing.dto.PricingCompareRequest;
import dev.sysflow.pricing.dto.PricingCompareResponse;
import dev.sysflow.simulation.model.GraphNode;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * End-to-end multi-cloud cost pipeline.
 * Synthesizes architecture topology, simulation traffic telemetry (RPS, throughput,
 * cache offload, replicas), and multi-cloud pricing models (AWS, GCP, Azure) to calculate
 * true total cost of ownership (TCO) for consumers.
 */
@Service
public class EndToEndCostPipeline {

    private static final double HOURS_PER_MONTH = 730.0;
    private static final double ASSUMED_STORAGE_GB = 100.0;
    private static final double SECONDS_PER_MONTH = 3600.0 * 24.0 * 30.5; // ~2,635,200 seconds/month
    private static final double AVG_PAYLOAD_KB = 8.0; // Typical API JSON response

    private static final Set<String> GENERIC_COMPUTE_TYPES = Set.of(
            "service", "worker", "serverless", "cronJob", "autoScalingGroup", "containerOrchestrator");
    private static final Set<String> MANAGED_DATABASE_TYPES = Set.of(
            "database", "dataWarehouse", "searchIndex", "dataLake");

    private final CostModel costModel;
    private final Map<String, CloudPricingProvider> providers = new LinkedHashMap<>();

    public EndToEndCostPipeline(CostModel costModel, List<CloudPricingProvider> providerList) {
        this.costModel = costModel;
        for (CloudPricingProvider p : providerList) {
            String pid = p.providerId() != null ? p.providerId() : "unknown";
            this.providers.put(pid, p);
        }
    }

    public PricingCompareResponse compare(PricingCompareRequest request) {
        List<PricingCompareRequest.NodeJson> nodes = request.graphJson().nodes();
        double targetRps = deriveSimulatedRps(request);
        double totalMonthlyRequests = targetRps * SECONDS_PER_MONTH;
        double monthlyRequestsMillions = totalMonthlyRequests / 1_000_000.0;

        // Detect CDN presence & caching efficiency
        double cdnHitRate = 0.0;
        boolean hasCdn = false;
        for (PricingCompareRequest.NodeJson n : nodes) {
            if ("cdn".equals(n.type())) {
                hasCdn = true;
                Object hitRate = n.config().get("hitRatePct");
                cdnHitRate = hitRate instanceof Number num ? num.doubleValue() / 100.0 : 0.90;
                break;
            }
        }

        // Monthly data transfer (in GB)
        double rawEgressGb = (totalMonthlyRequests * AVG_PAYLOAD_KB) / (1024.0 * 1024.0);
        double effectiveEgressGb = hasCdn ? (rawEgressGb * (1.0 - (cdnHitRate * 0.7))) : rawEgressGb;

        Map<String, PricingCompareResponse.ProviderCostSummary> providerSummaries = new LinkedHashMap<>();

        for (CloudPricingProvider provider : providers.values()) {
            List<PricingCompareResponse.NodeCostDetail> nodeDetails = new ArrayList<>();
            double provisionedSum = 0.0;
            double dynamicRequestsSum = 0.0;

            for (PricingCompareRequest.NodeJson n : nodes) {
                GraphNode node = new GraphNode(n.id(), n.type(), n.config());
                int units = costModel.unitsOf(node);

                PricingCompareResponse.NodeCostDetail detail = costNode(provider, n, node, units);
                nodeDetails.add(detail);
                provisionedSum += detail.monthlyCostUsd();

                // Dynamic request-volume fees (API Gateway, Queues, Serverless, WAF)
                Optional<Double> reqPrice = provider.pricePerMillionRequests(n.type());
                if (reqPrice.isPresent()) {
                    double effectiveReqMillions = monthlyRequestsMillions;
                    if (hasCdn && !"cdn".equals(n.type()) && !"dns".equals(n.type()) && !"waf".equals(n.type())) {
                        effectiveReqMillions *= (1.0 - cdnHitRate);
                    }
                    dynamicRequestsSum += effectiveReqMillions * reqPrice.get();
                }
            }

            double egressCost = effectiveEgressGb * provider.egressPricePerGb();
            double cacheSavings = hasCdn ? ((rawEgressGb - effectiveEgressGb) * provider.egressPricePerGb()) : 0.0;
            double totalMonthly = provisionedSum + dynamicRequestsSum + egressCost;

            providerSummaries.put(provider.providerId(), new PricingCompareResponse.ProviderCostSummary(
                    provider.providerId(),
                    provider.providerName(),
                    provider.defaultRegion(),
                    round2(totalMonthly),
                    round2(provisionedSum),
                    round2(dynamicRequestsSum),
                    round2(egressCost),
                    round2(cacheSavings),
                    nodeDetails
            ));
        }

        // Determine best value and recommendations
        String bestProvider = "";
        double minCost = Double.MAX_VALUE;
        double maxCost = 0.0;

        for (var entry : providerSummaries.entrySet()) {
            double cost = entry.getValue().totalMonthlyCostUsd();
            if (cost < minCost) {
                minCost = cost;
                bestProvider = entry.getKey() != null ? entry.getKey() : "";
            }
            if (cost > maxCost) {
                maxCost = cost;
            }
        }

        double maxSavings = maxCost > minCost ? round2(maxCost - minCost) : 0.0;
        List<String> recommendations = buildRecommendations(bestProvider, maxSavings, hasCdn, cdnHitRate, targetRps);

        PricingCompareResponse.DynamicUsageMetrics metrics = new PricingCompareResponse.DynamicUsageMetrics(
                round2(targetRps),
                round2(monthlyRequestsMillions),
                round2(effectiveEgressGb),
                round2(cdnHitRate * 100.0)
        );

        return new PricingCompareResponse(providerSummaries, bestProvider, maxSavings, metrics, recommendations);
    }

    private PricingCompareResponse.NodeCostDetail costNode(
            CloudPricingProvider provider, PricingCompareRequest.NodeJson n, GraphNode node, int units) {

        String explicitScale = node.getString("scale", "Auto");

        if (GENERIC_COMPUTE_TYPES.contains(n.type())) {
            double configuredSize = Math.max(node.getNumber("maxConcurrency", 0), node.getNumber("maxThroughput", 0));
            ScaleTier tier = parseScale(explicitScale, configuredSize, 800, 3000);
            var hourly = provider.hourlyComputePrice(tier);
            if (hourly.isPresent()) {
                double monthly = hourly.get() * HOURS_PER_MONTH * units;
                return new PricingCompareResponse.NodeCostDetail(
                        n.id(), n.type(), round2(monthly), "real",
                        provider.providerName() + " " + provider.computeSkuLabel(tier) + " (" + tier.label() + " tier, " + units + " units)"
                );
            }
        } else if (MANAGED_DATABASE_TYPES.contains(n.type())) {
            double configuredSize = node.getNumber("maxConnections", 0);
            ScaleTier tier = parseScale(explicitScale, configuredSize, 100, 500);
            var hourly = provider.hourlyDatabasePrice(tier);
            if (hourly.isPresent()) {
                double monthly = hourly.get() * HOURS_PER_MONTH * units;
                return new PricingCompareResponse.NodeCostDetail(
                        n.id(), n.type(), round2(monthly), "real",
                        provider.providerName() + " " + provider.databaseSkuLabel(tier) + " (" + tier.label() + " tier, " + units + " instances)"
                );
            }
        } else if ("cache".equals(n.type())) {
            double configuredSize = node.getNumber("maxThroughput", node.getNumber("maxConnections", 0));
            ScaleTier tier = parseScale(explicitScale, configuredSize, 1000, 5000);
            var hourly = provider.hourlyCachePrice(tier);
            if (hourly.isPresent()) {
                double monthly = hourly.get() * HOURS_PER_MONTH * units;
                return new PricingCompareResponse.NodeCostDetail(
                        n.id(), n.type(), round2(monthly), "real",
                        provider.providerName() + " " + provider.cacheSkuLabel(tier) + " (" + tier.label() + " tier, " + units + " units)"
                );
            }
        } else if ("objectStorage".equals(n.type())) {
            var perGb = provider.monthlyStorageCostPerGb();
            if (perGb.isPresent()) {
                double monthly = perGb.get() * ASSUMED_STORAGE_GB * units;
                return new PricingCompareResponse.NodeCostDetail(
                        n.id(), n.type(), round2(monthly), "real",
                        provider.providerName() + " " + provider.storageSkuLabel() + " (" + (int) ASSUMED_STORAGE_GB + " GB, " + units + " units)"
                );
            }
        } else if ("loadBalancer".equals(n.type())) {
            var hourly = provider.hourlyLoadBalancerPrice();
            if (hourly.isPresent()) {
                double monthly = hourly.get() * HOURS_PER_MONTH * units;
                return new PricingCompareResponse.NodeCostDetail(
                        n.id(), n.type(), round2(monthly), "real",
                        provider.providerName() + " " + provider.loadBalancerSkuLabel() + " (" + units + " units)"
                );
            }
        }

        // Illustrative fallback from costModel
        return new PricingCompareResponse.NodeCostDetail(
                n.id(), n.type(), round2(costModel.monthlyCostOf(node)), "illustrative",
                "Baseline baseline estimate for " + n.type()
        );
    }

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

    private ScaleTier tierFor(double configuredSize, double mediumMax, double largeMax) {
        if (configuredSize <= mediumMax * 0.5) return ScaleTier.XS_2GB;
        if (configuredSize <= mediumMax) return ScaleTier.SM_4GB;
        if (configuredSize <= largeMax * 0.5) return ScaleTier.MD_8GB;
        if (configuredSize <= largeMax) return ScaleTier.LG_16GB;
        return ScaleTier.XL_32GB;
    }

    private double deriveSimulatedRps(PricingCompareRequest request) {
        if (request.simulationSummary() != null && request.simulationSummary().avgRps() > 0) {
            return request.simulationSummary().avgRps();
        }
        if (request.targetRps() != null && request.targetRps() > 0) {
            return request.targetRps();
        }
        for (PricingCompareRequest.NodeJson n : request.graphJson().nodes()) {
            if ("client".equals(n.type()) || "mobile".equals(n.type()) || "webBrowser".equals(n.type())) {
                Object rps = n.config().get("targetRps");
                if (rps instanceof Number num && num.doubleValue() > 0) {
                    return num.doubleValue();
                }
            }
        }
        return 100.0; // Default baseline 100 RPS
    }

    private List<String> buildRecommendations(
            String bestProvider, double maxSavings, boolean hasCdn, double cdnHitRate, double rps) {
        List<String> recs = new ArrayList<>();
        if (bestProvider != null && !bestProvider.isBlank() && maxSavings > 5.0) {
            String name = switch (bestProvider) {
                case "aws" -> "AWS";
                case "gcp" -> "GCP";
                case "azure" -> "Azure";
                default -> bestProvider.toUpperCase();
            };
            recs.add(name + " is the most cost-effective provider for your architecture, saving up to $" + maxSavings + "/mo.");
        }
        if (hasCdn) {
            recs.add("CDN edge caching (" + (int) (cdnHitRate * 100) + "% hit rate) is absorbing traffic and cutting origin egress costs.");
        } else if (rps >= 100) {
            recs.add("Consider placing a CDN in front of your edge to reduce data egress and backend compute sizing.");
        }
        return recs;
    }

    private double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
