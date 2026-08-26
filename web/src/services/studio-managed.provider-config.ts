import type { StudioProviderPayload } from "@/services/studio-managed";
import type { ApiCallFormat } from "@/stores/use-config-store";

export type StudioProviderProtocolTemplate = "openai" | "gemini" | "agnes" | "grok2api" | "openai_async" | "generic_async";

export type StudioProviderAdvancedConfig = Pick<
    StudioProviderPayload,
    | "protocolTemplate"
    | "isAsync"
    | "createPath"
    | "pollPathTemplate"
    | "contentPathTemplate"
    | "taskIdField"
    | "statusField"
    | "resultUrlField"
    | "completedStatuses"
    | "failedStatuses"
    | "downloadResult"
    | "authMode"
    | "authHeaderName"
    | "authQueryName"
    | "extraHeaders"
    | "enabled"
>;

const baseAdvancedConfig: StudioProviderAdvancedConfig = {
    protocolTemplate: "openai",
    isAsync: false,
    createPath: "/images/generations",
    pollPathTemplate: "/tasks/{task_id}",
    contentPathTemplate: "",
    taskIdField: "id",
    statusField: "status",
    resultUrlField: "data.0.url",
    completedStatuses: ["succeeded", "completed"],
    failedStatuses: ["failed", "error", "cancelled"],
    downloadResult: false,
    authMode: "bearer",
    authHeaderName: "Authorization",
    authQueryName: "api_key",
    extraHeaders: {},
    enabled: true,
};

export function recommendedProtocolTemplate(apiFormat: ApiCallFormat): StudioProviderProtocolTemplate {
    if (apiFormat === "agnes") return "agnes";
    if (apiFormat === "grok") return "grok2api";
    if (["gemini", "imagen", "veo", "omni"].includes(apiFormat)) return "gemini";
    if (apiFormat === "sora") return "openai_async";
    if (["seedance", "minimax", "midjourney", "kling", "happyhors"].includes(apiFormat)) return "generic_async";
    return "openai";
}

export function createDefaultStudioProviderAdvancedConfig(apiFormat: ApiCallFormat = "openai"): StudioProviderAdvancedConfig {
    const protocolTemplate = recommendedProtocolTemplate(apiFormat);
    const commonAsyncConfig: StudioProviderAdvancedConfig = {
        ...baseAdvancedConfig,
        protocolTemplate,
        isAsync: true,
        createPath: "/videos",
        pollPathTemplate: "/videos/{task_id}",
        contentPathTemplate: "",
        taskIdField: "id",
        statusField: "status",
        resultUrlField: "url",
        completedStatuses: ["succeeded", "completed", "success", "succeed"],
        failedStatuses: ["failed", "error", "cancelled", "canceled"],
        downloadResult: false,
    };

    if (protocolTemplate === "openai_async") {
        return {
            ...commonAsyncConfig,
            contentPathTemplate: "/videos/{task_id}/content",
            downloadResult: true,
        };
    }
    if (apiFormat === "minimax") {
        return {
            ...commonAsyncConfig,
            createPath: "/video_generation",
            pollPathTemplate: "/query/video_generation?task_id={task_id}",
            taskIdField: "task_id",
            resultUrlField: "file_id",
            downloadResult: false,
        };
    }
    if (apiFormat === "midjourney") {
        return {
            ...commonAsyncConfig,
            createPath: "/mj/submit/imagine",
            pollPathTemplate: "/mj/task/{task_id}/fetch",
            taskIdField: "result",
            statusField: "status",
            resultUrlField: "imageUrl",
            completedStatuses: ["SUCCESS", "FINISHED", "completed"],
            failedStatuses: ["FAILURE", "FAILED", "failed"],
        };
    }
    if (apiFormat === "kling") {
        return {
            ...commonAsyncConfig,
            createPath: "/videos/text2video",
            pollPathTemplate: "/videos/{task_id}",
            taskIdField: "data.task_id",
            statusField: "data.task_status",
            resultUrlField: "data.task_result.videos.0.url",
            completedStatuses: ["succeed", "succeeded", "completed"],
            failedStatuses: ["failed", "failure"],
        };
    }
    if (apiFormat === "happyhors") {
        return {
            ...commonAsyncConfig,
            createPath: "/tasks",
            pollPathTemplate: "/tasks/{task_id}",
            taskIdField: "task_id",
            resultUrlField: "result_url",
        };
    }
    if (protocolTemplate === "generic_async") {
        return commonAsyncConfig;
    }
    if (protocolTemplate === "gemini") {
        return {
            ...baseAdvancedConfig,
            protocolTemplate,
            createPath: "/models/{model}:generateContent",
            pollPathTemplate: "/operations/{task_id}",
            taskIdField: "name",
            statusField: "done",
            resultUrlField: "response.generatedVideos.0.video.uri",
            completedStatuses: ["true", "succeeded", "completed"],
            failedStatuses: ["false", "failed", "error"],
            authMode: "query",
            authQueryName: "key",
        };
    }
    if (protocolTemplate === "agnes") {
        return {
            ...baseAdvancedConfig,
            protocolTemplate,
            createPath: "/images/generations",
            resultUrlField: "data.0.url",
        };
    }
    if (protocolTemplate === "grok2api") {
        return {
            ...baseAdvancedConfig,
            protocolTemplate,
            createPath: "/images/generations",
            resultUrlField: "data.0.url",
        };
    }
    return {
        ...baseAdvancedConfig,
        protocolTemplate,
    };
}

export function createStudioProviderPayloadDefaults(): Omit<StudioProviderPayload, "name" | "baseUrl" | "apiKey"> {
    return {
        apiFormat: "openai",
        ...createDefaultStudioProviderAdvancedConfig("openai"),
    };
}
