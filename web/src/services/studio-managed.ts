import axios from "axios";

import type { StudioProviderProtocolTemplate } from "@/services/studio-managed.provider-config";
import type { StudioPricingRules } from "@/lib/studio-pricing";
import { encodeChannelModel, type AiConfig, type ApiCallFormat, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

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
    pricingRules?: StudioPricingRules;
    provider: string;
    apiFormat?: ApiCallFormat;
    enabled: boolean;
    rowId?: number;
    providerId?: number;
};

export type StudioProvider = {
    id: number;
    name: string;
    base_url: string;
    api_key?: string;
    api_format: ApiCallFormat;
    protocol_template?: StudioProviderProtocolTemplate;
    is_async?: number | boolean;
    create_path?: string;
    poll_path_template?: string;
    content_path_template?: string;
    task_id_field?: string;
    status_field?: string;
    result_url_field?: string;
    completed_statuses?: string[];
    failed_statuses?: string[];
    download_result?: number | boolean;
    auth_mode?: "bearer" | "header" | "query";
    auth_header_name?: string;
    auth_query_name?: string;
    extra_headers?: Record<string, string>;
    enabled: number;
    created_at: number;
    updated_at: number;
};

export type StudioUsage = {
    id: number;
    external_key: string;
    source: string;
    user_id: string;
    username?: string;
    email?: string;
    model: string;
    capability: string;
    credits: number;
    balance_delta: number;
    unit_price?: number;
    unit_count?: number;
    success_count?: number;
    failed_count?: number;
    elapsed_ms?: number;
    status: string;
    error?: string;
    report_status?: string;
    report_note?: string;
    reported_at?: number;
    admin_refund_status?: string;
    admin_refund_credits?: number;
    admin_refunded_at?: number;
    created_at: number;
};

export type StudioWorkflow = {
    key: "ecommerce-suite" | "fashion-suite" | "video-suite";
    name: string;
    description: string;
    enabled: boolean;
    accessMode: "all" | "selected";
    allowedUsers: string[];
    updatedAt: number;
};

export type StudioWorkflowUserOption = {
    value: string;
    label: string;
    source: string;
    userId?: string;
    username?: string;
    email?: string;
};

export type StudioConcurrencyUser = {
    source: string;
    userId: string;
    username: string;
    email: string;
    label: string;
    overrideLimit: number | null;
    effectiveLimit: number;
    running: number;
    queued: number;
};

export type StudioConcurrencyConfig = {
    defaultLimit: number;
    fallbackLimit: number;
    maxLimit: number;
    users: StudioConcurrencyUser[];
};

type ApiEnvelope<T> = T & { success?: boolean; message?: string };
const STUDIO_AUTH_TIMEOUT_MS = 8000;
const STUDIO_CATALOG_TIMEOUT_MS = 8000;

export type StudioProviderPayload = {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    protocolTemplate?: StudioProviderProtocolTemplate;
    isAsync?: boolean;
    createPath?: string;
    pollPathTemplate?: string;
    contentPathTemplate?: string;
    taskIdField?: string;
    statusField?: string;
    resultUrlField?: string;
    completedStatuses?: string[];
    failedStatuses?: string[];
    downloadResult?: boolean;
    authMode?: "bearer" | "header" | "query";
    authHeaderName?: string;
    authQueryName?: string;
    extraHeaders?: Record<string, string>;
    enabled: boolean;
};

export function isStudioManagedHost() {
    return typeof window !== "undefined" && window.location.hostname.toLowerCase() === "studio.massmore.org";
}

export function studioApi(path: string) {
    return `/studio-api${path.startsWith("/") ? path : `/${path}`}`;
}

export async function studioSelf() {
    const response = await axios.get<ApiEnvelope<{ user: StudioUser }>>(studioApi("/auth/self"), { timeout: STUDIO_AUTH_TIMEOUT_MS });
    return response.data.user;
}

export async function studioLogin(source: "massmore" | "mtline", username: string, password: string) {
    const response = await axios.post<ApiEnvelope<{ user?: StudioUser; require2fa?: boolean; pendingToken?: string }>>(studioApi(`/auth/${source}/login`), { username, password });
    return response.data;
}

export async function studioMtline2fa(pendingToken: string, code: string) {
    const response = await axios.post<ApiEnvelope<{ user?: StudioUser }>>(studioApi("/auth/mtline/login/2fa"), { pendingToken, code });
    return response.data;
}

export async function studioAdminLogin(username: string, password: string) {
    const response = await axios.post<ApiEnvelope<{ user?: StudioUser }>>(studioApi("/admin/login"), { username, password });
    return response.data;
}

export async function studioLogout() {
    await axios.post(studioApi("/auth/logout"));
}

export async function fetchStudioCatalog() {
    const response = await axios.get<ApiEnvelope<{ models: StudioModel[] }>>(studioApi("/catalog/models"), { timeout: STUDIO_CATALOG_TIMEOUT_MS });
    return response.data.models || [];
}

export async function fetchStudioWorkflows() {
    const response = await axios.get<ApiEnvelope<{ workflows: StudioWorkflow[] }>>(studioApi("/workflows"), { timeout: STUDIO_CATALOG_TIMEOUT_MS });
    return response.data.workflows || [];
}

export async function fetchStudioAdminWorkflows() {
    const response = await axios.get<ApiEnvelope<{ workflows: StudioWorkflow[] }>>(studioApi("/admin/workflows"));
    return response.data.workflows || [];
}

export async function fetchStudioWorkflowUsers() {
    const response = await axios.get<ApiEnvelope<{ users: StudioWorkflowUserOption[] }>>(studioApi("/admin/workflow-users"));
    return response.data.users || [];
}

export async function updateStudioWorkflow(key: StudioWorkflow["key"], payload: Pick<StudioWorkflow, "enabled" | "accessMode" | "allowedUsers">) {
    const response = await axios.patch<ApiEnvelope<Record<string, never>>>(studioApi(`/admin/workflows/${encodeURIComponent(key)}`), payload);
    return response.data;
}

export async function fetchStudioConcurrency() {
    const response = await axios.get<ApiEnvelope<StudioConcurrencyConfig>>(studioApi("/admin/concurrency"));
    return response.data;
}

export async function updateStudioDefaultConcurrency(defaultLimit: number) {
    const response = await axios.patch<ApiEnvelope<{ defaultLimit: number }>>(studioApi("/admin/concurrency"), { defaultLimit });
    return response.data;
}

export async function updateStudioUserConcurrency(source: string, userId: string, limit: number) {
    const response = await axios.patch<ApiEnvelope<{ limit: number }>>(
        studioApi(`/admin/concurrency/users/${encodeURIComponent(source)}/${encodeURIComponent(userId)}`),
        { limit },
    );
    return response.data;
}

export async function resetStudioUserConcurrency(source: string, userId: string) {
    const response = await axios.delete<ApiEnvelope<Record<string, never>>>(
        studioApi(`/admin/concurrency/users/${encodeURIComponent(source)}/${encodeURIComponent(userId)}`),
    );
    return response.data;
}

export async function fetchStudioProviders() {
    const response = await axios.get<ApiEnvelope<{ providers: StudioProvider[] }>>(studioApi("/admin/providers"));
    return response.data.providers || [];
}

export async function createStudioProvider(payload: StudioProviderPayload) {
    const response = await axios.post<ApiEnvelope<{ id: number }>>(studioApi("/admin/providers"), payload);
    return response.data;
}

export async function updateStudioProvider(id: number, payload: Partial<StudioProviderPayload>) {
    const response = await axios.patch<ApiEnvelope<Record<string, never>>>(studioApi(`/admin/providers/${id}`), payload);
    return response.data;
}

export async function deleteStudioProvider(id: number) {
    const response = await axios.delete<ApiEnvelope<Record<string, never>>>(studioApi(`/admin/providers/${id}`));
    return response.data;
}

export async function fetchStudioAdminModels() {
    const response = await axios.get<ApiEnvelope<{ models: StudioModel[] }>>(studioApi("/admin/models"));
    return response.data.models || [];
}

export async function createStudioModel(payload: { providerId: number; model: string; displayName: string; capability: ModelCapability; creditCost: number; pricingRules?: StudioPricingRules; enabled: boolean }) {
    const response = await axios.post<ApiEnvelope<{ id: number }>>(studioApi("/admin/models"), payload);
    return response.data;
}

export async function updateStudioModel(id: number, payload: Partial<{ providerId: number; model: string; displayName: string; capability: ModelCapability; creditCost: number; pricingRules: StudioPricingRules; enabled: boolean }>) {
    const response = await axios.patch<ApiEnvelope<Record<string, never>>>(studioApi(`/admin/models/${id}`), payload);
    return response.data;
}

export async function deleteStudioModel(id: number) {
    const response = await axios.delete<ApiEnvelope<Record<string, never>>>(studioApi(`/admin/models/${id}`));
    return response.data;
}

export type StudioUsageFilters = {
    from?: number;
    to?: number;
    source?: string;
    user?: string;
    model?: string;
    capability?: string;
    status?: string;
    limit?: number;
};

export async function fetchStudioUsage(filters: StudioUsageFilters = {}) {
    const response = await axios.get<ApiEnvelope<{ usage: StudioUsage[] }>>(studioApi("/admin/usage"), { params: filters });
    return response.data.usage || [];
}

export async function fetchMyStudioUsage(filters: StudioUsageFilters = {}) {
    const response = await axios.get<ApiEnvelope<{ usage: StudioUsage[] }>>(studioApi("/usage"), { params: filters });
    return response.data.usage || [];
}

export async function submitStudioUsageReport(externalKey: string, note: string) {
    await axios.post<ApiEnvelope<Record<string, never>>>(studioApi("/usage/report"), { externalKey, note });
}

export async function updateStudioUsageReport(externalKey: string, reportStatus: "open" | "resolved") {
    await axios.patch<ApiEnvelope<Record<string, never>>>(studioApi(`/admin/usage/${encodeURIComponent(externalKey)}`), { reportStatus });
}

export async function refundStudioUsage(externalKey: string) {
    const response = await axios.post<ApiEnvelope<{ credits: number }>>(studioApi("/admin/usage/refund"), { externalKey });
    return Number(response.data.credits || 0);
}

export function catalogToConfigPatch(current: AiConfig, models: StudioModel[]): Partial<AiConfig> {
    const providerGroups = new Map<string, StudioModel[]>();
    for (const model of models.filter((item) => item.enabled)) {
        const provider = model.provider || "Studio";
        providerGroups.set(provider, [...(providerGroups.get(provider) || []), model]);
    }
    const channels: ModelChannel[] = Array.from(providerGroups.entries()).map(([provider, items], index) => ({
        id: `studio-${index + 1}`,
        name: provider,
        baseUrl: "https://studio.massmore.org",
        apiKey: "studio-managed",
        apiFormat: items[0]?.apiFormat || "openai",
        models: Array.from(new Set(items.map((item) => item.model))),
    }));
    const all = uniqueOptions(models.map((model) => encodeChannelModel(channelIdForProvider(channels, model.provider), model.model)).filter(Boolean));
    const byCapability = (capability: ModelCapability) => uniqueOptions(models.filter((model) => model.capability === capability && model.enabled).map((model) => encodeChannelModel(channelIdForProvider(channels, model.provider), model.model)));
    const imageModels = byCapability("image");
    const videoModels = byCapability("video");
    const textModels = byCapability("text");
    const audioModels = byCapability("audio");
    return {
        channels,
        baseUrl: "https://studio.massmore.org",
        apiKey: "studio-managed",
        apiFormat: channels[0]?.apiFormat || "openai",
        models: all,
        modelCosts: models.filter((model) => model.enabled).map((model) => ({ model: model.model, credits: Number(model.creditCost || 0) })),
        modelPricingRules: models.filter((model) => model.enabled).map((model) => ({ model: model.model, rules: model.pricingRules || {} })),
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: keepOrFirst(current.imageModel, imageModels),
        videoModel: keepOrFirst(current.videoModel, videoModels),
        textModel: keepOrFirst(current.textModel, textModels),
        audioModel: keepOrFirst(current.audioModel, audioModels),
        model: keepOrFirst(current.model, [...imageModels, ...textModels, ...videoModels, ...audioModels]),
    };
}

function channelIdForProvider(channels: ModelChannel[], provider: string) {
    return channels.find((channel) => channel.name === (provider || "Studio"))?.id || channels[0]?.id || "studio-1";
}

function keepOrFirst(current: string, options: string[]) {
    return options.includes(current) ? current : options[0] || "";
}

function uniqueOptions(options: string[]) {
    return Array.from(new Set(options.filter(Boolean)));
}
