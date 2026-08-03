import axios from "axios";

import { apiFormatLabel, buildApiUrl, isGeminiFormat, isStudioManagedRuntime, resolveModelRequestConfig, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ResponseInputMessage = AiTextMessage | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string } | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] } | { type: "function_call"; call_id: string; name: string; arguments: string } | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem = { type?: "message"; content?: Array<{ type?: string; text?: string }> } | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };
type ChatCompletionContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatCompletionMessage =
    { role: "system" | "user" | "assistant"; content: string | ChatCompletionContentPart[]; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> } | { role: "tool"; tool_call_id: string; content: string };
type ChatCompletionToolDefinition = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};
type ChatCompletionToolCallDelta = {
    index?: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
};
type ChatCompletionPayload = {
    choices?: Array<{
        message?: {
            content?: string | ChatCompletionContentPart[] | null;
            tool_calls?: Array<{ id?: string; type?: "function"; function?: { name?: string; arguments?: string } }>;
        };
        delta?: {
            content?: string | ChatCompletionContentPart[] | null;
            tool_calls?: ChatCompletionToolCallDelta[];
        };
        finish_reason?: string | null;
    }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ChatCompletionStreamState = {
    buffer: string;
    text: string;
    payload?: ChatCompletionPayload;
    error?: string;
    toolCalls: Map<number, ResponseToolCall>;
};

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
export type StudioAsyncJob = {
    jobId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "refund_failed" | "cancelled";
    error?: string;
    resultReady?: boolean;
    resultUrl?: string;
    previewUrls?: string[];
    queueAhead?: number | null;
    queuePosition?: number | null;
};
type StudioAsyncImage = { id: string; dataUrl: string };
type StudioAsyncImageJobWaiter = {
    promise: Promise<StudioAsyncImage[]>;
    statusListeners: Set<(job: StudioAsyncJob) => void>;
};
type RequestOptions = {
    signal?: AbortSignal;
    requestId?: string;
    idempotencyScope?: string;
    resumeJobId?: string;
    onAsyncJobCreated?: (jobId: string) => void;
    onAsyncJobStatus?: (job: StudioAsyncJob) => void;
};

// A canvas may resume the same persisted job after a focus change or reload.
// Keep one network waiter per job so those resumes share one poll and one R2 read.
const studioAsyncImageJobWaiters = new Map<string, StudioAsyncImageJobWaiter>();

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const IMAGE_RESOLUTION_LONG_EDGE: Record<string, number> = { "1k": 1024, "2k": 2048, "4k": 3840 };
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";
const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Map the selected output resolution and aspect ratio to an explicit image size. */
function resolveSize(imageResolution: string, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    const longSide = IMAGE_RESOLUTION_LONG_EDGE[imageResolution] || DEFAULT_IMAGE_SHORT_SIDE;
    const shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width: w, height: h };
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

function selectedImageResolution(config: AiConfig) {
    const value = String(config.imageResolution || "")
        .trim()
        .toLowerCase();
    if (value === "1k" || value === "2k" || value === "4k") return value;
    const quality = normalizeQuality(config.quality);
    if (quality === "low" || quality === "standard") return "1k";
    if (quality === "high") return "4k";
    return "2k";
}

function resolveRequestSize(config: AiConfig) {
    const value = config.size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(selectedImageResolution(config), value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveGeminiImageConfig(config: AiConfig) {
    const value = config.size.trim();
    const dimensions = parseImageDimensions(value);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : value;
    const aspectRatio = value && value.toLowerCase() !== "auto" ? closestGeminiAspectRatio(ratio) : undefined;
    const imageSize = supportsGeminiImageSize(config.model) ? resolveGeminiImageSize(config, dimensions) : undefined;
    const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
    return Object.keys(image).length ? { responseFormat: { image } } : {};
}

function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseImageRatio(item);
        const bestRatio = parseImageRatio(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

function resolveGeminiImageSize(config: AiConfig, dimensions: { width: number; height: number } | null) {
    const imageResolution = selectedImageResolution(config);
    if (imageResolution) return imageResolution.toUpperCase();
    if (!dimensions) return undefined;
    const edge = Math.max(dimensions.width, dimensions.height);
    if (edge <= 768) return "512";
    if (edge <= 1536) return "1K";
    if (edge <= 3072) return "2K";
    return "4K";
}

function supportsGeminiImageSize(model: string) {
    const value = model.toLowerCase();
    return value.includes("gemini-3") || value.includes("3.1") || value.includes("3-pro");
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return rewriteHostedImageUrl(item.url);
    }
    return null;
}

function rewriteHostedImageUrl(url: string) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname === "platform-outputs.agnes-ai.space" && typeof window !== "undefined" && window.location?.origin) {
            return `${window.location.origin}/__agnes_outputs${parsed.pathname}${parsed.search}`;
        }
        return parsed.toString();
    } catch {
        return url;
    }
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }
    const images =
        payload.data
            ?.map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];

    if (images.length === 0) {
        throw new Error("接口没有返回图片");
    }

    return images;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; message?: string; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return readableGenerationError(responseData?.msg || responseData?.message || responseData?.error?.message || readStatusError(error.response?.status, fallback));
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}

function enrichModelError(config: Pick<AiConfig, "apiFormat" | "model">, message: string, capability: "image" | "text" | "tool" | "models") {
    const lower = message.toLowerCase();
    const looksLikeModelMismatch = lower.includes("model") && (lower.includes("invalid") || lower.includes("not found") || lower.includes("does not exist") || lower.includes("unsupported"));
    if (!looksLikeModelMismatch) return message;
    const capabilityLabel = capability === "image" ? "生图" : capability === "models" ? "拉取模型" : "文本";
    return `${message}。当前渠道格式是 ${apiFormatLabel(config.apiFormat)}，当前${capabilityLabel}模型是 ${config.model || "未设置"}，请改成这个渠道真实支持的模型，或先重新拉取该渠道模型列表。`;
}

function readableGenerationError(message: string) {
    const raw = String(message || "");
    if (/content_policy_violation|content policy|内容安全|性感|挑逗|裸露|性暗示/i.test(raw)) return "内容安全策略拒绝了当前生成：请改为非暴露、非透视、无成人化表达的商品展示。行业套组会自动尝试一次合规商品图重试；若仍失败，请调整原图或描述。";
    if (/timed out|timeout|\b524\b/i.test(raw)) return "上游生成超时，请稍后重试。此次失败任务不会扣除积分。";
    return raw;
}

function requestHeaders(config: AiConfig, options?: RequestOptions, contentType?: string) {
    return { ...aiHeaders(config, contentType), ...(options?.requestId ? { "X-Studio-Generation-Id": options.requestId } : {}) };
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function isStudioAgnesProxyConfig(config: Pick<AiConfig, "apiFormat" | "apiKey">) {
    if (!isAgnesFormat(config)) return false;
    if (typeof window === "undefined") return false;
    return isStudioManagedRuntime() && !String(config.apiKey || "").trim();
}

function studioAgnesProxyUrl(path: string) {
    return `${window.location.origin}/__agnes_skill/v1${path}`;
}

function aiApiUrl(config: AiConfig, path: string) {
    if (isStudioAgnesProxyConfig(config)) return studioAgnesProxyUrl(path);
    return buildApiUrl(config.baseUrl, path);
}

function usesStudioAsyncImages(config: AiConfig) {
    return isStudioManagedRuntime() && !isGeminiFormat(config.apiFormat);
}

function studioJobIdempotencyKey(options?: RequestOptions) {
    return `${options?.requestId || `image_${nanoid()}`}:${options?.idempotencyScope || "initial"}`;
}

function waitForStudioJobPoll(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("请求已取消", "AbortError"));
            return;
        }
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("请求已取消", "AbortError"));
        };
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, 1800);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function fetchStudioAsyncImageJobResult(jobId: string, resultUrl?: string): Promise<StudioAsyncImage[]> {
    const response = await axios.get<ImageApiResponse>(resultUrl || `/studio-api/jobs/${encodeURIComponent(jobId)}/result`, { timeout: 120000 });
    return parseImagePayload(response.data);
}

export async function fetchStudioAsyncImageJob(jobId: string) {
    // Some embedded Chromium clients close idle requests after roughly 15 seconds.
    // Finish before that boundary so a normal poll never turns into a client-side 499.
    const response = await axios.get<{ job: StudioAsyncJob }>(`/studio-api/jobs/${encodeURIComponent(jobId)}?wait=10`, { timeout: 20000 });
    const job = response.data.job;
    return { ...job, previewUrls: job.previewUrls?.map(rewriteHostedImageUrl) };
}

function notifyStudioAsyncImageJobWaiter(waiter: StudioAsyncImageJobWaiter, job: StudioAsyncJob) {
    waiter.statusListeners.forEach((listener) => listener(job));
}

async function waitForSharedStudioAsyncImageJob(jobId: string, waiter: StudioAsyncImageJobWaiter): Promise<StudioAsyncImage[]> {
    for (;;) {
        let job: StudioAsyncJob;
        try {
            job = await fetchStudioAsyncImageJob(jobId);
        } catch (error) {
            if (!isRetryableStudioJobPollError(error)) throw error;
            await waitForStudioJobPoll();
            continue;
        }
        notifyStudioAsyncImageJobWaiter(waiter, job);
        if (job.status === "succeeded") {
            try {
                return await fetchStudioAsyncImageJobResult(jobId, job.resultUrl);
            } catch (error) {
                if (!isRetryableStudioJobPollError(error)) throw error;
                await waitForStudioJobPoll();
                continue;
            }
        }
        if (["failed", "refund_failed", "cancelled"].includes(job.status)) throw new Error(job.error || `图片任务${job.status}`);
        await waitForStudioJobPoll();
    }
}

function waitForStudioAsyncImageJobConsumer(promise: Promise<StudioAsyncImage[]>, signal?: AbortSignal) {
    if (!signal) return promise;
    return new Promise<StudioAsyncImage[]>((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("已停止在当前页面等待，后台原任务不会被重复提交", "AbortError"));
            return;
        }
        const onAbort = () => reject(new DOMException("已停止在当前页面等待，后台原任务不会被重复提交", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}

export function waitForStudioAsyncImageJob(jobId: string, options?: RequestOptions) {
    let waiter = studioAsyncImageJobWaiters.get(jobId);
    if (!waiter) {
        const statusListeners = new Set<(job: StudioAsyncJob) => void>();
        waiter = { statusListeners, promise: Promise.resolve([]) };
        waiter.promise = waitForSharedStudioAsyncImageJob(jobId, waiter);
        studioAsyncImageJobWaiters.set(jobId, waiter);
        void waiter.promise.then(
            () => {
                if (studioAsyncImageJobWaiters.get(jobId) === waiter) studioAsyncImageJobWaiters.delete(jobId);
            },
            () => {
                if (studioAsyncImageJobWaiters.get(jobId) === waiter) studioAsyncImageJobWaiters.delete(jobId);
            },
        );
    }
    if (options?.onAsyncJobStatus) waiter.statusListeners.add(options.onAsyncJobStatus);
    return waitForStudioAsyncImageJobConsumer(waiter.promise, options?.signal).finally(() => {
        if (options?.onAsyncJobStatus) waiter.statusListeners.delete(options.onAsyncJobStatus);
    });
}

function isRetryableStudioJobPollError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    const status = Number(error.response.status || 0);
    return [408, 409, 425, 429].includes(status) || status >= 500;
}

async function createStudioAsyncImageJob(body: Record<string, unknown> | FormData, kind: "generations" | "edits", options?: RequestOptions) {
    if (options?.resumeJobId) {
        options.onAsyncJobCreated?.(options.resumeJobId);
        return waitForStudioAsyncImageJob(options.resumeJobId, options);
    }
    const idempotencyKey = studioJobIdempotencyKey(options);
    try {
        const response = await axios.post<{ job: StudioAsyncJob }>(`/studio-api/jobs/image/${kind}`, body, {
            headers: { "Idempotency-Key": idempotencyKey },
            timeout: 120000,
        });
        options?.onAsyncJobCreated?.(response.data.job.jobId);
        options?.onAsyncJobStatus?.(response.data.job);
        return await waitForStudioAsyncImageJob(response.data.job.jobId, options);
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 409) return null;
        throw error;
    }
}

function aiHeaders(config: AiConfig, contentType?: string) {
    if (isStudioAgnesProxyConfig(config)) {
        return {
            ...(contentType ? { "Content-Type": contentType } : {}),
        };
    }
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

function supportsOpenAiImageFormatParams(config: Pick<AiConfig, "apiFormat">) {
    return config.apiFormat !== "agnes";
}
function isAgnesFormat(config: Pick<AiConfig, "apiFormat">) {
    return config.apiFormat === "agnes";
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">, options?: RequestOptions) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
        ...(options?.requestId ? { "X-Studio-Generation-Id": options.requestId } : {}),
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function prefersChatCompletions(config: Pick<AiConfig, "apiFormat">) {
    return !isGeminiFormat(config.apiFormat) && config.apiFormat !== "openai";
}

function shouldFallbackToChatCompletions(error: unknown) {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes("404") || message.includes("/responses") || message.includes("not found") || message.includes("unsupported") || message.includes("not support") || message.includes("unrecognized");
}

function toChatCompletionMessages(messages: ResponseInputMessage[]): ChatCompletionMessage[] {
    return messages.map((message) => {
        if ("type" in message) {
            return {
                role: "assistant" as const,
                content: "",
                tool_calls: [{ id: message.call_id, type: "function" as const, function: { name: message.name, arguments: message.arguments } }],
            };
        }
        if (message.role === "tool") {
            return { role: "tool" as const, tool_call_id: message.tool_call_id, content: message.content };
        }
        return {
            role: message.role,
            content: Array.isArray(message.content)
                ? message.content.map((item) => (item.type === "text" ? { type: "text" as const, text: item.text } : { type: "image_url" as const, image_url: { url: item.image_url.url } }))
                : String(message.content || ""),
        };
    });
}

function toChatCompletionTools(tools: ResponseFunctionTool[]): ChatCompletionToolDefinition[] {
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
            strict: tool.function.strict,
        },
    }));
}

function chatContentText(content: string | ChatCompletionContentPart[] | null | undefined) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((item) => (item.type === "text" ? item.text : "")).join("");
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function parseChatCompletionsPayload(payload: ChatCompletionPayload): ToolResponseResult {
    validateResponsePayload(payload);
    const choice = payload.choices?.[0];
    const content = chatContentText(choice?.message?.content);
    const toolCalls =
        choice?.message?.tool_calls
            ?.map((call) => ({
                id: call.id || nanoid(),
                type: "function" as const,
                function: {
                    name: call.function?.name || "",
                    arguments: call.function?.arguments || "{}",
                },
            }))
            .filter((call) => call.function.name) || [];
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function appendChatToolCall(state: ChatCompletionStreamState, chunk: ChatCompletionToolCallDelta) {
    const index = chunk.index ?? 0;
    const current =
        state.toolCalls.get(index) ||
        ({
            id: chunk.id || nanoid(),
            type: "function",
            function: { name: "", arguments: "" },
        } satisfies ResponseToolCall);
    if (chunk.id) current.id = chunk.id;
    if (chunk.function?.name) current.function.name += chunk.function.name;
    if (chunk.function?.arguments) current.function.arguments += chunk.function.arguments;
    state.toolCalls.set(index, current);
}

function consumeChatCompletionStreamBlock(block: string, state: ChatCompletionStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as ChatCompletionPayload;
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    const choice = event.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.content === "string") {
        state.text += delta.content;
        onDelta?.(state.text);
    } else if (Array.isArray(delta?.content)) {
        const text = chatContentText(delta.content);
        if (text) {
            state.text += text;
            onDelta?.(state.text);
        }
    }
    delta?.tool_calls?.forEach((toolCall) => appendChatToolCall(state, toolCall));
    if (choice?.message || choice?.finish_reason) state.payload = event;
}

function consumeChatCompletionStreamText(state: ChatCompletionStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeChatCompletionStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeChatCompletionStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...requestHeaders(config, options, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

async function requestChatCompletionsResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/chat/completions"), {
        method: "POST",
        headers: { ...requestHeaders(config, options, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ChatCompletionPayload;
        return parseChatCompletionsPayload(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ChatCompletionStreamState = { buffer: "", text: "", toolCalls: new Map() };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeChatCompletionStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeChatCompletionStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) {
        return { content: state.text, toolCalls: Array.from(state.toolCalls.values()).filter((call) => call.function.name) };
    }
    const result = parseChatCompletionsPayload(state.payload);
    const streamedToolCalls = Array.from(state.toolCalls.values()).filter((call) => call.function.name);
    return {
        content: state.text || result.content,
        toolCalls: streamedToolCalls.length ? streamedToolCalls : result.toolCalls,
    };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [config.systemPrompt.trim(), ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : []))].filter(Boolean).join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig = typeof toolChoice === "object" ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] } : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config, options),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await imageToDataUrl(image)));
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(config) } }),
            contents: [{ role: "user", parts }],
        },
        { headers: geminiHeaders(config, options), signal: options?.signal },
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

export async function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    if (isGeminiFormat(requestConfig.apiFormat)) {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw new Error(enrichModelError(requestConfig, readAxiosError(error, "??????"), "image"));
        }
    }
    const quality = normalizeQuality(requestConfig.quality);
    const requestSize = resolveRequestSize(requestConfig);
    const requestBody: Record<string, unknown> = {
        model: requestConfig.model,
        prompt: withSystemPrompt(requestConfig, prompt),
        n,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
    };
    if (supportsOpenAiImageFormatParams(requestConfig)) {
        requestBody.response_format = "b64_json";
        requestBody.output_format = IMAGE_OUTPUT_FORMAT;
    }
    try {
        if (usesStudioAsyncImages(requestConfig)) {
            const asyncImages = await createStudioAsyncImageJob(requestBody, "generations", options);
            if (asyncImages) return asyncImages;
        }
        const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/generations"), requestBody, {
            headers: requestHeaders(requestConfig, options, "application/json"),
            signal: options?.signal,
        });
        const images = parseImagePayload(response.data);
        return images;
    } catch (error) {
        throw new Error(enrichModelError(requestConfig, readAxiosError(error, "??????"), "image"));
    }
}

export async function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const requestPrompt = buildImageReferencePromptText(prompt, references);
    if (isGeminiFormat(requestConfig.apiFormat)) {
        if (mask) throw new Error("Gemini image edit does not support masks yet");
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw new Error(enrichModelError(requestConfig, readAxiosError(error, "??????"), "image"));
        }
    }
    if (isAgnesFormat(requestConfig)) {
        if (mask) throw new Error("Agnes image edit does not support masks yet");
        const quality = normalizeQuality(requestConfig.quality);
        const requestSize = resolveRequestSize(requestConfig);
        const requestBody: Record<string, unknown> = {
            model: requestConfig.model,
            prompt: withSystemPrompt(requestConfig, requestPrompt),
            n,
            ...(quality ? { quality } : {}),
            ...(requestSize ? { size: requestSize } : {}),
            extra_body: {
                image: await Promise.all(references.map((image) => imageToDataUrl(image))),
                response_format: "b64_json",
            },
        };
        try {
            if (usesStudioAsyncImages(requestConfig)) {
                const asyncImages = await createStudioAsyncImageJob(requestBody, "generations", options);
                if (asyncImages) return asyncImages;
            }
            const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/generations"), requestBody, {
                headers: requestHeaders(requestConfig, options, "application/json"),
                signal: options?.signal,
            });
            return parseImagePayload(response.data);
        } catch (error) {
            throw new Error(enrichModelError(requestConfig, readAxiosError(error, "Request failed"), "image"));
        }
    }
    const quality = normalizeQuality(requestConfig.quality);
    const requestSize = resolveRequestSize(requestConfig);
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    formData.set("n", String(n));
    if (supportsOpenAiImageFormatParams(requestConfig)) {
        formData.set("response_format", "b64_json");
        formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    }
    if (quality) {
        formData.set("quality", quality);
    }
    if (requestSize) {
        formData.set("size", requestSize);
    }
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));

    try {
        if (usesStudioAsyncImages(requestConfig)) {
            const asyncImages = await createStudioAsyncImageJob(formData, "edits", options);
            if (asyncImages) return asyncImages;
        }
        const response = await axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/edits"), formData, { headers: requestHeaders(requestConfig, options), signal: options?.signal });
        const images = parseImagePayload(response.data);
        return images;
    } catch (error) {
        throw new Error(enrichModelError(requestConfig, readAxiosError(error, "图片生成失败"), "image"));
    }
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (isGeminiFormat(requestConfig.apiFormat)) {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "未返回文本内容";
            if (answer === "未返回文本内容") onDelta(answer);
            return answer;
        }
        const answer =
            (
                await (prefersChatCompletions(requestConfig)
                    ? requestChatCompletionsResponse(
                          requestConfig,
                          {
                              model: requestConfig.model,
                              messages: toChatCompletionMessages(withSystemMessage(requestConfig, messages)),
                          },
                          onDelta,
                          options,
                      )
                    : requestStreamingResponse(
                          requestConfig,
                          {
                              model: requestConfig.model,
                              input: toResponseInput(withSystemMessage(requestConfig, messages)),
                          },
                          onDelta,
                          options,
                      ).catch((error) => {
                          if (!shouldFallbackToChatCompletions(error)) throw error;
                          return requestChatCompletionsResponse(
                              requestConfig,
                              {
                                  model: requestConfig.model,
                                  messages: toChatCompletionMessages(withSystemMessage(requestConfig, messages)),
                              },
                              onDelta,
                              options,
                          );
                      }))
            ).content || "未返回文本内容";
        if (answer === "未返回文本内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(enrichModelError(requestConfig, readAxiosError(error, "请求失败"), "text"));
    }
}

export async function requestToolResponse(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (isGeminiFormat(requestConfig.apiFormat)) {
            return await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages, toGeminiToolOptions(tools, toolChoice)), onDelta, options);
        }
        if (prefersChatCompletions(requestConfig)) {
            return await requestChatCompletionsResponse(
                requestConfig,
                {
                    model: requestConfig.model,
                    messages: toChatCompletionMessages(withSystemMessage(requestConfig, messages)),
                    tools: toChatCompletionTools(tools),
                    tool_choice: toolChoice,
                    parallel_tool_calls: false,
                },
                onDelta,
                options,
            );
        }
        return await requestStreamingResponse(
            requestConfig,
            {
                model: requestConfig.model,
                input: toResponseInput(withSystemMessage(requestConfig, messages)),
                tools: tools.map(toResponseTool),
                tool_choice: toolChoice,
                parallel_tool_calls: false,
            },
            onDelta,
            options,
        ).catch((error) => {
            if (!shouldFallbackToChatCompletions(error)) throw error;
            return requestChatCompletionsResponse(
                requestConfig,
                {
                    model: requestConfig.model,
                    messages: toChatCompletionMessages(withSystemMessage(requestConfig, messages)),
                    tools: toChatCompletionTools(tools),
                    tool_choice: toolChoice,
                    parallel_tool_calls: false,
                },
                onDelta,
                options,
            );
        });
    } catch (error) {
        throw new Error(enrichModelError(requestConfig, readAxiosError(error, "请求失败"), "tool"));
    }
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (isStudioAgnesProxyConfig(config)) {
            const response = await axios.get<{ data?: Array<{ id?: string }> }>(studioAgnesProxyUrl("/models"));
            return (response.data.data || [])
                .map((model) => model.id)
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        if (isGeminiFormat(config.apiFormat)) {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }) });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};
