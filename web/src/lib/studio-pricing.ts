import { modelOptionName, type ModelCapability } from "@/stores/use-config-store";

export type PricingEntry = {
    enabled: boolean;
    credits: number;
};

export type StudioPricingRules = {
    image?: {
        quality?: Record<"high" | "medium" | "low", PricingEntry>;
        size?: Record<"1k" | "2k" | "4k", PricingEntry>;
    };
    video?: {
        resolution?: Record<"480p" | "720p" | "1080p" | "4k", PricingEntry>;
    };
};

export const imageQualityItems = [
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
] as const;

export const imageSizeTierItems = [
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
] as const;

export const videoResolutionItems = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
    { value: "4k", label: "4K" },
] as const;

export function defaultPricingRules(capability: ModelCapability, creditCost = 0): StudioPricingRules {
    if (capability === "image") {
        return {
            image: {
                quality: {
                    high: { enabled: true, credits: creditCost },
                    medium: { enabled: true, credits: creditCost },
                    low: { enabled: true, credits: creditCost },
                },
                size: {
                    "1k": { enabled: true, credits: 0 },
                    "2k": { enabled: true, credits: 0 },
                    "4k": { enabled: true, credits: 0 },
                },
            },
        };
    }
    if (capability === "video") {
        return {
            video: {
                resolution: {
                    "480p": { enabled: true, credits: creditCost },
                    "720p": { enabled: true, credits: creditCost },
                    "1080p": { enabled: true, credits: creditCost },
                    "4k": { enabled: true, credits: creditCost },
                },
            },
        };
    }
    return {};
}

export function normalizePricingRules(capability: ModelCapability, rules?: StudioPricingRules, creditCost = 0): StudioPricingRules {
    const defaults = defaultPricingRules(capability, creditCost);
    if (capability === "image") {
        return {
            image: {
                quality: mergeEntries(defaults.image?.quality, rules?.image?.quality),
                size: mergeEntries(defaults.image?.size, rules?.image?.size),
            },
        };
    }
    if (capability === "video") {
        return {
            video: {
                resolution: mergeEntries(defaults.video?.resolution, rules?.video?.resolution),
            },
        };
    }
    return rules || {};
}

function mergeEntries<T extends string>(defaults?: Record<T, PricingEntry>, current?: Partial<Record<T, Partial<PricingEntry> | number>>) {
    const result = { ...(defaults || {}) } as Record<T, PricingEntry>;
    for (const [key, value] of Object.entries(current || {}) as Array<[T, Partial<PricingEntry> | number]>) {
        const base = result[key] || { enabled: true, credits: 0 };
        result[key] = typeof value === "number" ? { enabled: true, credits: value } : { enabled: value.enabled !== false, credits: Number(value.credits ?? base.credits ?? 0) };
    }
    return result;
}

export function enabledImageQualities(rules?: StudioPricingRules) {
    const quality = rules?.image?.quality;
    if (!quality) return ["auto", ...imageQualityItems.map((item) => item.value)];
    const enabled = imageQualityItems.filter((item) => quality[item.value]?.enabled !== false).map((item) => item.value);
    return ["auto", ...enabled];
}

export function enabledImageSizeTiers(rules?: StudioPricingRules) {
    const size = rules?.image?.size;
    if (!size) return imageSizeTierItems.map((item) => item.value);
    return imageSizeTierItems.filter((item) => size[item.value]?.enabled !== false).map((item) => item.value);
}

export function enabledVideoResolutions(rules?: StudioPricingRules) {
    const resolution = rules?.video?.resolution;
    if (!resolution) return videoResolutionItems.map((item) => item.value);
    return videoResolutionItems.filter((item) => resolution[item.value]?.enabled !== false).map((item) => item.value);
}

export function modelPricingRules(modelPricingRules: Array<{ model: string; rules: StudioPricingRules }> | undefined, model: string) {
    const normalizedModel = modelOptionName(model);
    return modelPricingRules?.find((item) => item.model === normalizedModel)?.rules;
}

export function imageSizeTier(size: string) {
    const value = String(size || "auto").toLowerCase();
    if (value === "auto") return "2k";
    if (value.includes("4k")) return "4k";
    if (value.includes("2k")) return "2k";
    const match = value.match(/^(\d+)x(\d+)$/);
    if (match) {
        const longSide = Math.max(Number(match[1]), Number(match[2]));
        if (longSide <= 1280) return "1k";
        if (longSide <= 2304) return "2k";
        return "4k";
    }
    return "1k";
}

export function normalizedVideoResolution(value: string) {
    const raw = String(value || "720").toLowerCase();
    if (raw === "480" || raw === "480p" || raw === "low") return "480p";
    if (raw === "1080" || raw === "1080p") return "1080p";
    if (raw === "4k" || raw === "2160" || raw === "2160p") return "4k";
    return "720p";
}

export function pricingRuleUnitCost(options: { modelCosts?: Array<{ model: string; credits: number }>; modelPricingRules?: Array<{ model: string; rules: StudioPricingRules }>; model: string; capability: ModelCapability; quality?: string; size?: string; vquality?: string }) {
    const model = modelOptionName(options.model);
    const fallback = options.modelCosts?.find((item) => item.model === model)?.credits || 0;
    const rules = modelPricingRules(options.modelPricingRules, model);
    if (options.capability === "image" && rules?.image) {
        const qualityKey = options.quality === "auto" ? "medium" : (options.quality || "medium");
        const sizeKey = imageSizeTier(options.size || "auto");
        const qualityCost = rules.image.quality?.[qualityKey as "high" | "medium" | "low"]?.enabled === false ? 0 : Number(rules.image.quality?.[qualityKey as "high" | "medium" | "low"]?.credits ?? fallback);
        const sizeCost = rules.image.size?.[sizeKey as "1k" | "2k" | "4k"]?.enabled === false ? 0 : Number(rules.image.size?.[sizeKey as "1k" | "2k" | "4k"]?.credits ?? 0);
        return qualityCost + sizeCost;
    }
    if (options.capability === "video" && rules?.video) {
        const resolution = normalizedVideoResolution(options.vquality || "720");
        return Number(rules.video.resolution?.[resolution as "480p" | "720p" | "1080p" | "4k"]?.credits ?? fallback);
    }
    return fallback;
}
