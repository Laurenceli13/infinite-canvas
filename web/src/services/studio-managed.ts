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
    user_id?: string;
    username?: string;
    email?: string;
    provider_id?: number;
    provider_name?: string;
    model: string;
    capability: string;
    unit_count?: number;
    credits: number;
    balance_delta?: number;
    elapsed_ms?: number;
    status: string;
    error?: string;
    request_path?: string;
    created_at: number;
};

export type StudioConcurrencyConfig = {
    globalLimit: number;
    defaultLimit: number;
    runningTotal: number;
    queuedTotal: number;
    users?: Array<{
        source: string;
        userId: string;
        username?: string;
        email?: string;
        running: number;
        queued: number;
        overrideLimit?: number | null;
        effectiveLimit: number;
    }>;
};

export type StudioWorkflow = {
    key: string;
    name: string;
    description: string;
    enabled: boolean;
    accessMode: "all" | "selected";
    allowedUsers: string[];
    updatedAt: number;
};

export type StudioAccount = {
    source: string;
    userId: string;
    username: string;
    email: string;
    balance: number;
    points: number;
    updatedAt: number;
};

export type StudioPricingSettings = {
    pointsPerDollar: number;
    sourceBalanceUnitsPerDollar: number;
    massmoreSourceBalanceUnitsPerDollar: number;
    mtlineSourceBalanceUnitsPerDollar: number;
};

export type StudioStorageProvider = {
    id: string;
    name: string;
    type: "s3" | "webdav";
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
    pathPrefix: string;
    username: string;
    password: string;
    weight: number;
    enabled: boolean;
};

export type StudioStorageSettings = {
    mode: "local_indexeddb" | "server_sqlite_s3";
    allowUserProvider: boolean;
    allowUserGlobalProvider: boolean;
    providers: StudioStorageProvider[];
    roundRobinCursor: number;
};

export type StudioStoredFile = {
    id: string;
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
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

export async function updateStudioUserConcurrency(source: string, userId: string, limit: number) {
    const response = await axios.patch<Envelope<{ limit: number }>>(studioApi(`/admin/concurrency/users/${encodeURIComponent(source)}/${encodeURIComponent(userId)}`), { limit });
    return response.data;
}

export async function resetStudioUserConcurrency(source: string, userId: string) {
    await axios.delete(studioApi(`/admin/concurrency/users/${encodeURIComponent(source)}/${encodeURIComponent(userId)}`));
}

export async function fetchStudioUsage(params?: { status?: string; limit?: number }) {
    const response = await axios.get<Envelope<{ usage: StudioUsage[] }>>(studioApi("/usage"), { params });
    return response.data.usage || [];
}

export async function fetchStudioAdminUsage(params?: { status?: string; limit?: number }) {
    const response = await axios.get<Envelope<{ usage: StudioUsage[] }>>(studioApi("/admin/usage"), { params });
    return response.data.usage || [];
}

export async function fetchStudioWorkflows() {
    const response = await axios.get<Envelope<{ workflows: StudioWorkflow[] }>>(studioApi("/admin/workflows"));
    return response.data.workflows || [];
}

export async function fetchStudioWorkflowUsers() {
    const response = await axios.get<Envelope<{ users: Array<{ value: string; label: string }> }>>(studioApi("/admin/workflow-users"));
    return response.data.users || [];
}

export async function updateStudioWorkflow(key: string, payload: { enabled: boolean; accessMode: "all" | "selected"; allowedUsers: string[] }) {
    await axios.patch(studioApi(`/admin/workflows/${encodeURIComponent(key)}`), payload);
}

export async function fetchStudioAccounts() {
    const response = await axios.get<Envelope<{ users: StudioAccount[] }>>(studioApi("/admin/users"));
    return response.data.users || [];
}

export async function fetchStudioPricingSettings() {
    const response = await axios.get<Envelope<{ pricing: StudioPricingSettings }>>(studioApi("/admin/settings"));
    return response.data.pricing;
}

export async function updateStudioPricingSettings(payload: Partial<StudioPricingSettings>) {
    await axios.patch(studioApi("/admin/settings"), payload);
}

export async function fetchStudioStorageConfig() {
    const response = await axios.get<Envelope<{ storage: StudioStorageSettings }>>(studioApi("/storage/config"));
    return response.data.storage;
}

export async function fetchStudioStorageSettings() {
    const response = await axios.get<Envelope<{ storage: StudioStorageSettings }>>(studioApi("/admin/storage-settings"));
    return response.data.storage;
}

export async function updateStudioStorageSettings(storage: StudioStorageSettings) {
    const response = await axios.patch<Envelope<{ storage: StudioStorageSettings }>>(studioApi("/admin/storage-settings"), { storage });
    return response.data.storage;
}

export function studioStoredFileUrl(id: string) {
    return studioApi(`/files/${encodeURIComponent(id)}/content`);
}

export async function uploadStudioStoredFile(blob: Blob, filename: string, provider?: Record<string, unknown>) {
    const formData = new FormData();
    formData.append("file", blob, filename);
    if (provider) formData.append("provider", JSON.stringify(provider));
    const response = await fetch(studioApi("/files"), { method: "POST", body: formData, credentials: "same-origin" });
    const payload = await response.json().catch(() => null) as Envelope<{ file?: StudioStoredFile }> | null;
    if (!response.ok || !payload?.success || !payload.file) throw new Error(payload?.message || "Studio 存储上传失败");
    return payload.file;
}

export async function deleteStudioStoredFile(id: string, provider?: Record<string, unknown>) {
    const response = await fetch(studioApi(`/files/${encodeURIComponent(id)}`), {
        method: "DELETE",
        credentials: "same-origin",
        headers: provider ? { "Content-Type": "application/json" } : undefined,
        body: provider ? JSON.stringify({ provider }) : undefined,
    });
    const payload = await response.json().catch(() => null) as Envelope<Record<string, never>> | null;
    if (!response.ok || !payload?.success) throw new Error(payload?.message || "Studio 存储删除失败");
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
