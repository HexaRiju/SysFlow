package dev.sysflow.pricing;

/**
 * Memory-based scale tiers for cloud resource sizing.
 * Each tier maps to specific cloud SKUs per provider (e.g., t3.small for 2GB on AWS).
 * Replaces the old SMALL/MEDIUM/LARGE tiers with actual resource dimensions.
 */
public enum ScaleTier {
    XS_2GB(2, "2 GB"),
    SM_4GB(4, "4 GB"),
    MD_8GB(8, "8 GB"),
    LG_16GB(16, "16 GB"),
    XL_32GB(32, "32 GB");

    private final int memoryGb;
    private final String label;

    ScaleTier(int memoryGb, String label) {
        this.memoryGb = memoryGb;
        this.label = label;
    }

    public int memoryGb() {
        return memoryGb;
    }

    public String label() {
        return label;
    }

    /** Pick the closest scale tier for a given memory size in GB. */
    public static ScaleTier forMemoryGb(int gb) {
        if (gb <= 2) return XS_2GB;
        if (gb <= 4) return SM_4GB;
        if (gb <= 8) return MD_8GB;
        if (gb <= 16) return LG_16GB;
        return XL_32GB;
    }

    /** Map old-style configured sizes (concurrency/throughput) to a scale tier. */
    public static ScaleTier fromConfiguredSize(double configuredSize, double smallMax, double mediumMax) {
        if (configuredSize <= smallMax * 0.5) return XS_2GB;
        if (configuredSize <= smallMax) return SM_4GB;
        if (configuredSize <= mediumMax * 0.5) return MD_8GB;
        if (configuredSize <= mediumMax) return LG_16GB;
        return XL_32GB;
    }
}
