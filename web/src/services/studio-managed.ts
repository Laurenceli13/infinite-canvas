import axios from "axios";

import type { ModelCapability, AiConfig, LocalModelChannel } from "@/stores/use-config-store";

export type StudioUser = {
    id: string;
    username: string;
    email: string;
    source: "massmore" | "mtline" | "studio";
    role: "user" | "studio_admin";
    balance: number;
    points: number;
    pointsPerDollar: number;
    rechargeUrl: string;
};

export type StudioModel = {
    id: string;
    model: string;
    displayName: string;
    capability: ModelCapability;
    creditCost: number;
    pricingRules?: Record<string, unknown>;
    provider: string;
    apiFormat?: LocalModelChannel["protocol"];
    protocolTemplate?: string;
    enabled: boolean;
    rowId?: number;
    providerId?: number;
    failoverEnabled?: boolean;
    failoverRouteModelIds?: number[];
};

export type StudioProvider = {
    id: number;
    name: string;
    base_url: string;
    api_format: LocalModelChannel["protocol"];
    protocol_template?: string;
    is_async?: number | boolean;
    enabled: number | boolean;
};

export type StudioConnectionTestResult = {
    ok: boolean;
    statusCode?: number | null;
    message: string;
    modelFound?: boolean | null;
};

export type StudioUsage = {
    id: number;
    source: string;
    username?: string;
    provider_name?: string;
    model: string;
    capability: string;
    unit_count?: number;
    credits: number;
    elapsed_ms?: number;
    status: string;
    error?: string;
    created_at: number;
};

export type StudioConcurrencyConfig = {
    globalLimit: number;
    defaultLimit: number;
    runningTotal: number;
    queuedTotal: number;
};

type Envelope<T> = T & { success?: boolean; message?: string };

export function isStudioManagedHost() {
    if (typeof window === "undefined") return false;
    return ["studio.massmore.org", "studio.linkfoai.com"].includes(window.location.hostname.toLowerCase());
}

export function studioApi(path: string) {
    return `/studio-api${path.startsWith("/") ? path : `/${path}`}`;
}

export async function studioSelf() {
    const response = await axios.get<Envelope<{ user: StudioUser }>>(studioApi("/auth/self"), { timeout: 8000 });
    return response.data.user;
}

export async function studioLogin(source: "massmore" | "mtline", username: string, password: string) {
    const response = await axios.post<Envelope<{ user?: StudioUser; require2fa?: boolean; pendingToken?: string }>>(studioApi(`/auth/${source}/login`), { username, password });
    return response.data;
}

export async function studioMtline2fa(pendingToken: string, code: string) {
    const response = await axios.post<Envelope<{ user?: StudioUser }>>(studioApi("/auth/mtline/login/2fa"), { pendingToken, code });
    return response.data;
}

export async function studioAdminLogin(username: string, password: string) {
    const response = await axios.post<Envelope<{ user?: StudioUser }>>(studioApi("/admin/login"), { username, password });
    return response.data;
}

export async function studioLogout() {
    await axios.post(studioApi("/auth/logout"));
}

export async function fetchStudioCatalog() {
    const response = await axios.get<Envelope<{ models: StudioModel[] }>>(studioApi("/catalog/models"), { timeout: 8000 });
    return response.data.models || [];
}

export async function fetchStudioProviders() {
    const response = await axios.get<Envelope<{ providers: StudioProvider[] }>>(studioApi("/admin/providers"));
    return response.data.providers || [];
}

export async function createStudioProvider(payload: Record<string, unknown>) {
    const response = await axios.post<Envelope<{ id: number }>>(studioApi("/admin/providers"), payload);
    return response.data;
}

export async function updateStudioProvider(id: number, payload: Record<string, unknown>) {
    const response = await axios.patch<Envelope<Record<string, never>>>(studioApi(`/admin/providers/${id}`), payload);
    return response.data;
}

export async function deleteStudioProvider(id: number) {
    await axios.delete(studioApi(`/admin/providers/${id}`));
}

export async function testStudioProvider(id: number) {
    const response = await axios.post<Envelope<{ result: StudioConnectionTestResult }>>(studioApi(`/admin/providers/${id}/test`));
    return response.data.result;
}

export async function discoverStudioProviderModels(id: number) {
    const response = await axios.post<Envelope<{ models: Array<{ id: string; displayName: string }> }>>(studioApi(`/admin/providers/${id}/models`));
    return response.data.models || [];
}

export async function fetchStudioAdminModels() {
    const response = await axios.get<Envelope<{ models: StudioModel[] }>>(studioApi("/admin/models"));
    return response.data.models || [];
}

export async function createStudioModel(payload: Record<string, unknown>) {
    const response = await axios.post<Envelope<{ id: number }>>(studioApi("/admin/models"), payload);
    return response.data;
}

export async function updateStudioModel(id: number, payload: Record<string, unknown>) {
    const response = await axios.patch<Envelope<Record<string, never>>>(studioApi(`/admin/models/${id}`), payload);
    return response.data;
}

export async function deleteStudioModel(id: number) {
    await axios.delete(studioApi(`/admin/models/${id}`));
}

export async function testStudioModel(id: number) {
    const response = await axios.post<Envelope<{ result: StudioConnectionTestResult }>>(studioApi(`/admin/models/${id}/test`));
    return response.data.result;
}

export async function updateStudioModelFailover(id: number, enabled: boolean, routeModelIds: number[]) {
    const response = await axios.patch<Envelope<Record<string, never>>>(studioApi(`/admin/models/${id}/failover`), { enabled, routeModelIds });
    return response.data;
}

export async function fetchStudioConcurrency() {
    const response = await axios.get<Envelope<StudioConcurrencyConfig>>(studioApi("/admin/concurrency"));
    return response.data;
}

export async function updateStudioConcurrencySettings(globalLimit: number, defaultLimit: number) {
    const response = await axios.patch<Envelope<Record<string, never>>>(studioApi("/admin/concurrency"), { globalLimit, defaultLimit });
    return response.data;
}

export async function fetchStudioUsage() {
    const response = await axios.get<Envelope<{ usage: StudioUsage[] }>>(studioApi("/admin/usage"));
    return response.data.usage || [];
}

export function catalogToConfigPatch(current: AiConfig, models: StudioModel[]): Partial<AiConfig> {
    const enabled = models.filter((item) => item.enabled);
    const channelsByProvider = new Map<string, LocalModelChannel>();
    for (const item of enabled) {
        const provider = item.provider || "Studio";
        const channel = channelsByProvider.get(provider) || {
            id: `studio-${channelsByProvider.size + 1}`,
            protocol: item.protocolTemplate === "grok2api" ? "grok2api" : item.apiFormat || "openai",
            name: provider,
            baseUrl: typeof window === "undefined" ? "" : window.location.origin,
            apiKey: "studio-managed",
            models: [],
        };
        if (!channel.models.includes(item.model)) channel.models.push(item.model);
        channelsByProvider.set(provider, channel);
    }
    const channels = [...channelsByProvider.values()];
    const modelsByCapability = (capability: ModelCapability) => enabled.filter((item) => item.capability === capability).map((item) => item.model);
    const firstOrCurrent = (value: string, options: string[]) => options.includes(value) ? value : options[0] || "";
    const imageModels = modelsByCapability("image");
    const videoModels = modelsByCapability("video");
    const textModels = modelsByCapability("text");
    const audioModels = modelsByCapability("audio");
    const allModels = enabled.map((item) => item.model);
    const modelDisplayNames = Object.fromEntries(enabled.map((item) => [item.model, item.displayName || item.model]));

    return {
        channelMode: "local",
        localChannels: channels,
        publicChannels: [],
        baseUrl: typeof window === "undefined" ? "" : window.location.origin,
        apiKey: "studio-managed",
        models: allModels,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        modelDisplayNames,
        modelCosts: enabled.map((item) => ({ model: item.model, credits: Number(item.creditCost || 0) })),
        modelPricingRules: enabled.map((item) => ({ model: item.model, rules: item.pricingRules || {} })),
        imageModel: firstOrCurrent(current.imageModel, imageModels),
        videoModel: firstOrCurrent(current.videoModel, videoModels),
        textModel: firstOrCurrent(current.textModel, textModels),
        audioModel: firstOrCurrent(current.audioModel, audioModels),
        model: firstOrCurrent(current.model, allModels),
        imageChannelId: channels.find((channel) => channel.models.some((model) => imageModels.includes(model)))?.id || channels[0]?.id || "",
        videoChannelId: channels.find((channel) => channel.models.some((model) => videoModels.includes(model)))?.id || channels[0]?.id || "",
        textChannelId: channels.find((channel) => channel.models.some((model) => textModels.includes(model)))?.id || channels[0]?.id || "",
        audioChannelId: channels.find((channel) => channel.models.some((model) => audioModels.includes(model)))?.id || channels[0]?.id || "",
        activeChannelId: channels[0]?.id || "",
    } as Partial<AiConfig>;
}
