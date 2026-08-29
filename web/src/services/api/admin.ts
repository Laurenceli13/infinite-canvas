import { apiDelete, apiGet, apiPost, compactApiParams } from "@/services/api/request";
import type { Prompt, PromptListResponse } from "@/services/api/prompts";
import {
    fetchStudioAccounts,
    fetchStudioAdminUsage,
    isStudioManagedHost,
    type StudioAccount,
    type StudioUsage,
} from "@/services/studio-managed";

function isStudioAdminSession(token: string) {
    return isStudioManagedHost() && token === "studio-session";
}

function studioTimestamp(value: number | undefined) {
    return value ? new Date(value * 1000).toISOString() : "";
}

function studioAccountToAdminUser(item: StudioAccount): AdminUser {
    return {
        id: `${item.source}:${item.userId}`,
        username: item.username,
        email: item.email,
        displayName: item.username,
        avatarUrl: "",
        role: "user",
        credits: item.points,
        affCode: "",
        affCount: 0,
        inviterId: "",
        linuxDoId: "",
        status: "active",
        lastLoginAt: studioTimestamp(item.updatedAt),
        createdAt: "",
        updatedAt: studioTimestamp(item.updatedAt),
    };
}

function studioUsageToCreditLog(item: StudioUsage): AdminCreditLog {
    const isRefund = item.status === "refunded" || item.status === "refund_failed";
    return {
        id: String(item.id),
        userId: `${item.source}:${item.user_id || item.username || "-"}`,
        userDisplayName: item.username || "",
        type: isRefund ? "ai_refund" : "ai_consume",
        amount: isRefund ? Number(item.credits || 0) : -Number(item.credits || 0),
        balance: 0,
        relatedId: "",
        remark: [item.provider_name, item.model, item.capability].filter(Boolean).join(" / "),
        extra: item.error || item.status || "",
        createdAt: studioTimestamp(item.created_at),
    };
}

function studioUsageToAICallLog(item: StudioUsage): AdminAICallLog {
    const success = item.status === "success" || item.status === "succeeded" || item.status === "charged";
    return {
        id: String(item.id),
        userId: item.user_id || `${item.source}:${item.username || "-"}`,
        userDisplayName: item.username || "",
        endpoint: item.request_path || "-",
        method: "POST",
        model: item.model,
        channelId: item.provider_name || "",
        channelName: item.provider_name || "",
        status: success ? 200 : item.status === "running" ? 102 : 502,
        durationMs: Number(item.elapsed_ms || 0),
        credits: Number(item.credits || 0),
        requestBody: "",
        responseBody: item.error || "",
        error: item.error || "",
        createdAt: studioTimestamp(item.created_at),
    };
}

export type AdminPromptCategory = {
    category: string;
    name: string;
    description: string;
    file: string;
    githubUrl: string;
    remote: boolean;
};

export type AdminUser = {
    id: string;
    username: string;
    email: string;
    displayName: string;
    avatarUrl: string;
    role: "user" | "admin";
    credits: number;
    affCode: string;
    affCount: number;
    inviterId: string;
    linuxDoId: string;
    status: "active" | "ban";
    lastLoginAt: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminUserListResponse = {
    items: AdminUser[];
    total: number;
};

export type AdminCreditLog = {
    id: string;
    userId: string;
    userDisplayName: string;
    type: string;
    amount: number;
    balance: number;
    relatedId: string;
    remark: string;
    extra: string;
    createdAt: string;
};

export type AdminCreditLogListResponse = {
    items: AdminCreditLog[];
    total: number;
};

export type AdminUserQuery = {
    keyword?: string;
    page?: number;
    pageSize?: number;
};

export async function fetchAdminUsers(token: string, query: AdminUserQuery = {}) {
    if (isStudioAdminSession(token)) {
        const users = (await fetchStudioAccounts()).map(studioAccountToAdminUser);
        const keyword = String(query.keyword || "").trim().toLowerCase();
        const filtered = keyword ? users.filter((item) => [item.username, item.email, item.displayName, item.id].some((value) => value.toLowerCase().includes(keyword))) : users;
        const page = Math.max(1, Number(query.page || 1));
        const pageSize = Math.max(1, Number(query.pageSize || 10));
        return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };
    }
    return apiGet<AdminUserListResponse>("/api/admin/users", compactApiParams(query), token);
}

export async function saveAdminUser(token: string, user: Partial<AdminUser> & { password?: string }) {
    return apiPost<AdminUser>("/api/admin/users", user, token);
}

export async function adjustAdminUserCredits(token: string, id: string, credits: number) {
    return apiPost<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}/credits`, { credits }, token);
}

export async function deleteAdminUser(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/users/${encodeURIComponent(id)}`, token);
}

export async function fetchAdminCreditLogs(token: string, query: AdminUserQuery = {}) {
    if (isStudioAdminSession(token)) {
        const logs = (await fetchStudioAdminUsage({ limit: 500 })).map(studioUsageToCreditLog);
        const keyword = String(query.keyword || "").trim().toLowerCase();
        const filtered = keyword ? logs.filter((item) => [item.userId, item.userDisplayName, item.type, item.remark, item.relatedId].some((value) => value.toLowerCase().includes(keyword))) : logs;
        const page = Math.max(1, Number(query.page || 1));
        const pageSize = Math.max(1, Number(query.pageSize || 10));
        return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };
    }
    return apiGet<AdminCreditLogListResponse>("/api/admin/credit-logs", compactApiParams(query), token);
}

export async function saveAdminCreditLog(token: string, log: Partial<AdminCreditLog>) {
    return apiPost<AdminCreditLog>("/api/admin/credit-logs", log, token);
}

export async function deleteAdminCreditLog(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/credit-logs/${encodeURIComponent(id)}`, token);
}

export async function fetchAdminPromptCategories(token: string) {
    if (isStudioAdminSession(token)) {
        const prompts = await apiGet<PromptListResponse>("/api/prompts");
        return (prompts.categories || []).map((category) => ({ category, name: category, description: "", file: "", githubUrl: "", remote: false }));
    }
    return apiGet<AdminPromptCategory[]>("/api/admin/prompt-categories", undefined, token);
}

export async function syncAdminPromptCategory(token: string, category: string) {
    return apiPost<AdminPromptCategory[]>("/api/admin/prompt-categories/sync", { category }, token);
}

export async function syncAdminPromptCategoriesAll(token: string) {
    return apiPost<AdminPromptCategory[]>("/api/admin/prompt-categories/sync-all", {}, token);
}

export type AdminPromptQuery = {
    keyword?: string;
    category?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

export type AdminAsset = {
    id: string;
    title: string;
    type: "text" | "image" | "video" | "audio";
    coverUrl: string;
    tags: string[];
    category: string;
    description: string;
    content: string;
    url: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminAssetListResponse = {
    items: AdminAsset[];
    tags: string[];
    total: number;
};

export async function fetchAdminPrompts(token: string, query: AdminPromptQuery = {}) {
    if (isStudioAdminSession(token)) {
        return apiGet<PromptListResponse>("/api/prompts", compactApiParams(query));
    }
    return apiGet<PromptListResponse>("/api/admin/prompts", compactApiParams(query), token);
}

export async function saveAdminPrompt(token: string, prompt: Partial<Prompt>) {
    return apiPost<Prompt>("/api/admin/prompts", prompt, token);
}

export async function deleteAdminPrompt(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/prompts/${encodeURIComponent(id)}`, token);
}

export async function deleteAdminPrompts(token: string, ids: string[]) {
    return apiPost<boolean>("/api/admin/prompts/batch-delete", { ids }, token);
}

export type AdminAssetQuery = {
    keyword?: string;
    type?: string;
    tag?: string[];
    page?: number;
    pageSize?: number;
};

export async function fetchAdminAssets(token: string, query: AdminAssetQuery = {}) {
    if (isStudioAdminSession(token)) {
        return apiGet<AdminAssetListResponse>("/api/assets", compactApiParams(query));
    }
    return apiGet<AdminAssetListResponse>("/api/admin/assets", compactApiParams(query), token);
}

export async function saveAdminAsset(token: string, asset: Partial<AdminAsset>) {
    return apiPost<AdminAsset>("/api/admin/assets", asset, token);
}

export async function deleteAdminAsset(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/assets/${encodeURIComponent(id)}`, token);
}

export type AdminModelChannel = {
    id: string;
    protocol: "openai" | "gemini" | "grok2api" | "metaso" | "apimart" | "kie" | "mimo";
    name: string;
    baseUrl: string;
    apiKey: string;
    models: string[];
    weight: number;
    timeout: number;
    enabled: boolean;
    remark: string;
};

export type AdminPublicModelChannelSettings = {
    availableModels: string[];
    modelCosts: AdminModelCost[];
    channels: AdminPublicModelChannelInfo[];
    defaultModel: string;
    defaultImageModel: string;
    defaultVideoModel: string;
    defaultTextModel: string;
    systemPrompt: string;
    systemPrompts: {
        image: string;
        video: string;
        text: string;
        workflow: string;
        workflowAgent: string;
    };
    allowCustomChannel: boolean;
    allowUserRemoteChannel: boolean;
};

export type AdminModelCost = {
    model: string;
    credits: number;
};

export type AdminPublicModelChannelInfo = {
    id: string;
    protocol: AdminModelChannel["protocol"];
    name: string;
    baseUrl: string;
    models: string[];
    weight: number;
    timeout: number;
    enabled: boolean;
    remark: string;
};

export type AdminPublicSettings = {
    modelChannel: AdminPublicModelChannelSettings;
    auth: {
        allowRegister: boolean;
        linuxDo: {
            enabled: boolean;
        };
    };
    storage: {
        mode: string;
        allowUserProvider: boolean;
    };
};

export type AdminStorageProvider = {
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
    ownerUserId: string;
    capacityBytes: number;
    capacityCheckedAt: string;
    capacityExceeded: boolean;
};

export type AdminPrivateSettings = {
    channels: AdminModelChannel[];
    promptSync: {
        enabled: boolean;
        cron: string;
    };
    aiLog: {
        localDirectReportEnabled: boolean;
        cleanup: {
            enabled: boolean;
            retentionDays: number;
            cron: string;
        };
    };
    auth: {
        linuxDo: {
            clientId: string;
            clientSecret: string;
        };
    };
    storage: {
        mode: string;
        allowUserProvider: boolean;
        allowUserGlobalProvider: boolean;
        providers: AdminStorageProvider[];
        roundRobinCursor: number;
        capacityCheck: {
            enabled: boolean;
            cron: string;
        };
        capacityLimitBytes: number;
    };
};

export type AdminAICallLog = {
    id: string;
    userId: string;
    userDisplayName: string;
    endpoint: string;
    method: string;
    model: string;
    channelId: string;
    channelName: string;
    status: number;
    durationMs: number;
    credits: number;
    requestBody: string;
    responseBody: string;
    error: string;
    createdAt: string;
};

export type AdminAICallLogListResponse = {
    items: AdminAICallLog[];
    total: number;
};

export async function fetchAdminAICallLogs(token: string, query: AdminUserQuery = {}) {
    if (isStudioAdminSession(token)) {
        const logs = (await fetchStudioAdminUsage({ limit: 500 })).map(studioUsageToAICallLog);
        const keyword = String(query.keyword || "").trim().toLowerCase();
        const filtered = keyword ? logs.filter((item) => [item.userId, item.userDisplayName, item.endpoint, item.model, item.channelName, item.error].some((value) => value.toLowerCase().includes(keyword))) : logs;
        const page = Math.max(1, Number(query.page || 1));
        const pageSize = Math.max(1, Number(query.pageSize || 20));
        return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };
    }
    return apiGet<AdminAICallLogListResponse>("/api/admin/ai-logs", compactApiParams(query), token);
}

export async function deleteAdminAICallLogs(token: string, olderThanDays = 7) {
    return apiDelete<{ removedFiles: number }>(`/api/admin/ai-logs?olderThanDays=${encodeURIComponent(String(olderThanDays))}`, token);
}

export type AdminSettings = {
    public: AdminPublicSettings;
    private: AdminPrivateSettings;
};

export async function fetchAdminSettings(token: string) {
    return apiGet<AdminSettings>("/api/admin/settings", undefined, token);
}

export async function saveAdminSettings(token: string, settings: AdminSettings) {
    return apiPost<AdminSettings>("/api/admin/settings", settings, token);
}

export type AdminChannelActionRequest = {
    index?: number;
    channel: AdminModelChannel;
    model?: string;
};

export async function fetchChannelModels(token: string, payload: AdminChannelActionRequest) {
    return apiPost<string[]>("/api/admin/settings/channel-models", payload, token);
}

export async function testChannelModel(token: string, payload: AdminChannelActionRequest) {
    return apiPost<string>("/api/admin/settings/channel-test", payload, token);
}

export type StorageCapacityResult = {
    bytes: number;
    limitBytes: number;
    overLimit: boolean;
    checkedAt: string;
    providerName: string;
};

export async function measureAdminStorageProvider(token: string, payload: { index: number; provider: AdminStorageProvider }) {
    return apiPost<StorageCapacityResult>("/api/admin/storage/measure", payload, token);
}
