import type { ComponentProps } from "react";
import { Zap } from "lucide-react";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Zap className="size-[1em] fill-current" strokeWidth={2.4} />
        </span>
    );
}

export type ModelCreditCost = {
    model: string;
    credits: number;
};

export type ModelPricingRule = {
    model: string;
    rules: Record<string, unknown>;
};

export function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    return modelCosts?.find((item) => item.model === model)?.credits || 0;
}

export function requestCreditCost(options: {
    channelMode: string;
    modelCosts?: ModelCreditCost[];
    modelPricingRules?: ModelPricingRule[];
    modelDisplayNames?: Record<string, string>;
    model: string;
    capability?: "image" | "video" | "text" | "audio";
    count?: string | number;
    duration?: string | number;
    quality?: string;
    size?: string;
    vquality?: string;
}) {
    const modelKey = resolveManagedModelKey(options);
    const hasManagedPricing = Boolean(modelKey);
    if (options.channelMode !== "remote" && !hasManagedPricing) return 0;
    const count = options.capability === "video"
        ? Math.max(1, Math.ceil(Math.abs(Number(options.duration ?? options.count)) || 1))
        : Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    return resolveUnitCost({ ...options, model: modelKey || options.model }) * count;
}

function resolveManagedModelKey(options: Parameters<typeof requestCreditCost>[0]) {
    const model = String(options.model || "").trim();
    if (!model) return "";
    const candidates = new Set([model]);
    const separatorIndex = model.lastIndexOf("::");
    if (separatorIndex >= 0) candidates.add(model.slice(separatorIndex + 2));
    const displayNames = options.modelDisplayNames || {};
    for (const [key, displayName] of Object.entries(displayNames)) {
        if (displayName === model || candidates.has(displayName)) candidates.add(key);
    }
    return options.modelCosts?.find((item) => candidates.has(item.model))?.model
        || options.modelPricingRules?.find((item) => candidates.has(item.model))?.model
        || "";
}

function resolveUnitCost(options: Parameters<typeof requestCreditCost>[0]) {
    const fallback = modelCreditCost(options.modelCosts, options.model);
    const rules = options.modelPricingRules?.find((item) => item.model === options.model)?.rules || {};
    if (options.capability === "image") {
        const imageRules = recordValue(rules.image);
        const qualityRules = recordValue(imageRules.quality);
        const sizeRules = recordValue(imageRules.size);
        if (!Object.keys(qualityRules).length && !Object.keys(sizeRules).length) return fallback;
        const qualityCost = pricingOptionCost(qualityRules, normalizeImageQuality(options.quality), fallback);
        const sizeCost = pricingOptionCost(sizeRules, normalizeImageSizeTier(options.size), 0);
        if (qualityCost === undefined && sizeCost === undefined) return fallback;
        return (qualityCost ?? 0) + (sizeCost ?? 0);
    }
    if (options.capability === "video") {
        const resolutionRules = recordValue(recordValue(rules.video).resolution);
        if (!Object.keys(resolutionRules).length) return fallback;
        const resolutionCost = pricingOptionCost(resolutionRules, normalizeVideoResolution(options.vquality), fallback);
        return resolutionCost === undefined ? fallback : resolutionCost;
    }
    return fallback;
}

function recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pricingOptionCost(options: Record<string, unknown>, key: string, fallback: number) {
    const option = options[key] ?? (key.endsWith("p") ? options[key.slice(0, -1)] : undefined);
    if (option === undefined) return undefined;
    if (typeof option === "number") return option;
    if (!option || typeof option !== "object" || Array.isArray(option)) return fallback;
    const credits = Number((option as Record<string, unknown>).credits ?? fallback);
    return Number.isFinite(credits) ? credits : fallback;
}

function normalizeImageQuality(value: string | undefined) {
    const normalized = String(value || "auto").trim().toLowerCase();
    if (normalized === "high" || normalized === "hd") return "high";
    if (normalized === "low") return "low";
    return "medium";
}

function normalizeImageSizeTier(value: string | undefined) {
    const raw = String(value || "auto").trim().toLowerCase();
    if (raw === "auto" || raw === "" || raw === "medium") return "2k";
    if (raw === "1k" || raw === "1024") return "1k";
    if (raw === "4k" || raw === "4096" || raw === "3840" || raw.includes("-4k")) return "4k";
    if (raw === "2k" || raw === "2048") return "2k";
    const match = raw.match(/^(\d+)\s*x\s*(\d+)$/);
    if (match) {
        const longSide = Math.max(Number(match[1]), Number(match[2]));
        if (longSide <= 1280) return "1k";
        if (longSide <= 2304) return "2k";
        return "4k";
    }
    if (raw.includes("-2k")) return "2k";
    return "1k";
}

function normalizeVideoResolution(value: string | undefined) {
    const raw = String(value || "720").trim().toLowerCase();
    if (raw === "480" || raw === "480p" || raw === "low") return "480p";
    if (raw === "1080" || raw === "1080p") return "1080p";
    if (raw === "4k" || raw === "2160" || raw === "2160p") return "4k";
    return "720p";
}
