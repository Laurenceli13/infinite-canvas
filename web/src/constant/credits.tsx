import type { ComponentProps } from "react";
import { Zap } from "lucide-react";
import { type ModelCapability } from "@/stores/use-config-store";
import { pricingRuleUnitCost, type StudioPricingRules } from "@/lib/studio-pricing";

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

export function requestCreditUnits(options: { capability: ModelCapability; count?: string | number; seconds?: string | number }) {
    if (options.capability === "image") return Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    if (options.capability === "video") return Math.max(1, Math.ceil(Math.abs(Number(options.seconds)) || 1));
    return 1;
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; modelPricingRules?: Array<{ model: string; rules: StudioPricingRules }>; model: string; capability?: ModelCapability; count?: string | number; seconds?: string | number; quality?: string; size?: string; imageResolution?: string; vquality?: string }) {
    const isStudioManaged = typeof window !== "undefined" && window.location.hostname.toLowerCase() === "studio.massmore.org";
    const hasManagedPricing = Boolean(options.modelCosts?.length || options.modelPricingRules?.length);
    if (options.channelMode !== "remote" && !isStudioManaged && !hasManagedPricing) return 0;
    const capability = options.capability || "image";
    const units = requestCreditUnits({ capability, count: options.count, seconds: options.seconds });
    const unitCost = pricingRuleUnitCost({ modelCosts: options.modelCosts, modelPricingRules: options.modelPricingRules, model: options.model, capability, quality: options.quality, size: options.size, imageResolution: options.imageResolution, vquality: options.vquality });
    return unitCost * units;
}
