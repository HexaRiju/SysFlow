package dev.sysflow.pricing;

/**
 * Represents a priced SKU for a specific scale tier.
 *
 * @param hourlyUsd   The hourly cost in USD.
 * @param skuName     The technical SKU name (e.g., "t3.medium").
 * @param description A human-readable description of the SKU.
 */
public record SkuPrice(double hourlyUsd, String skuName, String description) {
}
