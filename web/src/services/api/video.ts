import axios from "axios";

import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildApiUrl, isGeminiFormat, isStudioManagedRuntime, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string } };
type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};
type AgnesVideoPayload = Record<string, unknown>;
type ApiEnvelope<T> = T | { code?: number; data?: T | null; msg?: string };
type RequestOptions = { signal?: AbortSignal; requestId?: string; onTaskCreated?: (task: VideoGenerationTask) => void };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "agnes"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

function isAgnesVideoFormat(config: Pick<AiConfig, "apiFormat">) {
    return config.apiFormat === "agnes";
}

function isStudioAgnesProxyConfig(config: Pick<AiConfig, "apiFormat" | "apiKey">) {
    if (!isAgnesVideoFormat(config)) return false;
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

function requestHeaders(config: AiConfig, options?: RequestOptions, contentType?: string) {
    return { ...aiHeaders(config, contentType), ...(options?.requestId ? { "X-Studio-Generation-Id": options.requestId } : {}) };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    options?.onTaskCreated?.(task);
    return waitForVideoGenerationTask(config, task, options);
}

export async function waitForVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationResult> {
    const delayMs = task.provider === "seedance" ? 5000 : task.provider === "agnes" ? 8000 : 2500;
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        let state: VideoGenerationTaskState;
        try {
            state = await pollVideoGenerationTask(config, task, options);
        } catch (error) {
            if (!isRetryableVideoPollError(error) || options?.signal?.aborted) throw error;
            await delay(delayMs, options?.signal);
            continue;
        }
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new VideoTaskTerminalError(state.error);
        if (attempt === 119) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

function isRetryableVideoPollError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    const status = Number(error.response.status || 0);
    return [408, 409, 425, 429].includes(status) || status >= 500;
}

export function isTerminalVideoTaskError(error: unknown) {
    return error instanceof VideoTaskTerminalError;
}

class VideoTaskTerminalError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VideoTaskTerminalError";
    }
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    // A canvas can retain its previous image/text model in `model`; video requests
    // must always prefer the explicitly selected video model.
    const selectedModel = (config.videoModel || config.model).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (isAgnesVideoFormat(requestConfig)) {
        if (videoReferences.length || audioReferences.length) throw new Error("Agnes 视频当前只支持文本或图片参考，请移除参考视频和参考音频后重试");
        return createAgnesVideoTask(requestConfig, selectedModel, prompt, references, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    return task.provider === "seedance" ? pollSeedanceTask(requestConfig, task, options) : task.provider === "agnes" ? pollAgnesVideoTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
    throw new Error("视频接口没有返回可播放的视频");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: requestHeaders(config, options), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function createAgnesVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    try {
        const referenceImages = await Promise.all(references.slice(0, 4).map(async (image) => imageToDataUrl(image)));
        const payload: Record<string, unknown> = {
            model: modelOptionName(model),
            prompt,
            seconds: normalizeVideoSeconds(config.videoSeconds),
            size: normalizeVideoSize(config.size) || "1280x720",
            vquality: config.vquality || "720",
            ...agnesVideoDurationParams(config.videoSeconds),
        };
        if (referenceImages.length === 1) {
            payload.image = referenceImages[0];
        } else if (referenceImages.length > 1) {
            payload.extra_body = {
                image: referenceImages,
                mode: "keyframes",
            };
        }
        const created = unwrapAgnesPayload((await axios.post<AgnesVideoPayload>(aiApiUrl(config, "/videos"), payload, { headers: requestHeaders(config, options, "application/json"), signal: options?.signal })).data, "Agnes 视频接口没有返回任务");
        const id = agnesTaskId(created);
        if (!id) throw new Error("Agnes 视频接口没有返回任务 ID");
        return { id, provider: "agnes", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Agnes 视频任务创建失败"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        if (video.status === "completed") {
            return { status: "completed", result: await videoResultFromTask(config, task.id, options) };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: video.error?.message || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function pollAgnesVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const payload = unwrapAgnesPayload((await axios.get<AgnesVideoPayload>(aiApiUrl(config, `/videos/${encodeURIComponent(task.id)}`), { headers: aiHeaders(config), signal: options?.signal })).data, "Agnes 视频任务查询失败");
        const status = agnesTaskStatus(payload);
        if (status === "completed" || status === "succeeded" || status === "success") {
            const url = agnesVideoUrl(payload);
            if (!url) return { status: "failed", error: "Agnes 视频任务已完成，但没有返回视频地址" };
            return { status: "completed", result: await videoResultFromTask(config, task.id, options, url) };
        }
        if (status === "failed" || status === "error" || status === "cancelled") {
            return { status: "failed", error: agnesTaskError(payload) || "Agnes 视频生成失败" };
        }
        return { status: "pending" };
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
            return { status: "pending" };
        }
        throw new Error(readAxiosError(error, "Agnes 视频任务查询失败"));
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(model)),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    try {
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        if (state.status === "succeeded") {
            const url = state.content?.video_url;
            if (!url) return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
            return { status: "completed", result: await videoResultFromTask(config, task.id, options, url) };
        }
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: state.error?.message || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、素材 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

async function videoResultFromTask(config: AiConfig, taskId: string, options?: RequestOptions, fallbackUrl?: string): Promise<VideoGenerationResult> {
    // Studio owns the task and retrieves completed videos through its signed,
    // same-origin asset route. Other deployments retain their direct provider flow.
    const isStudioManaged = isStudioManagedRuntime();
    if (!isStudioManaged) {
        if (!fallbackUrl) {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${taskId}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { blob: content.data };
        }
        return videoResultFromUrl(fallbackUrl, options);
    }
    try {
        const content = await axios.get<Blob>(`${window.location.origin}/studio-api/v1/videos/${encodeURIComponent(taskId)}/content`, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(content.data);
        return { blob: content.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        throw new Error(readAxiosError(error, "视频成品取回失败"));
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim() && !isStudioAgnesProxyConfig(config)) throw new Error("请先配置 API Key");
    if (isGeminiFormat(config.apiFormat)) throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(18, seconds)));
}

function agnesVideoDurationParams(value: string) {
    const seconds = Number(normalizeVideoSeconds(value));
    const frameRate = 24;
    const numFrames = Math.min(441, Math.max(81, Math.round(seconds * frameRate) + 1));
    return { num_frames: numFrames, frame_rate: frameRate };
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unwrapAgnesPayload(payload: AgnesVideoPayload, emptyMessage: string) {
    const unwrapped = unwrapEnvelope<Record<string, unknown> | Array<Record<string, unknown>>>(payload as ApiEnvelope<Record<string, unknown> | Array<Record<string, unknown>>>, emptyMessage);
    if (Array.isArray(unwrapped)) {
        const first = unwrapped.find(isRecord);
        if (first) return first;
        throw new Error(emptyMessage);
    }
    if (!isRecord(unwrapped)) throw new Error(emptyMessage);
    return unwrapped;
}

function agnesCandidateRecords(payload: AgnesVideoPayload) {
    const candidates: Record<string, unknown>[] = [];
    if (isRecord(payload)) candidates.push(payload);
    const data = isRecord(payload) ? payload.data : undefined;
    if (Array.isArray(data)) {
        data.filter(isRecord).forEach((item) => candidates.push(item));
    } else if (isRecord(data)) {
        candidates.push(data);
    }
    return candidates;
}

function agnesTaskId(payload: AgnesVideoPayload) {
    for (const candidate of agnesCandidateRecords(payload)) {
        for (const key of ["task_id", "id", "video_id"]) {
            const value = candidate[key];
            if (typeof value === "string" && value.trim()) return value.trim();
        }
    }
    return "";
}

function agnesTaskStatus(payload: AgnesVideoPayload) {
    for (const candidate of agnesCandidateRecords(payload)) {
        const status = candidate.status;
        if (typeof status === "string" && status.trim()) return status.trim().toLowerCase();
    }
    return "";
}

function agnesTaskError(payload: AgnesVideoPayload) {
    for (const candidate of agnesCandidateRecords(payload)) {
        if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error.trim();
        if (isRecord(candidate.error) && typeof candidate.error.message === "string" && candidate.error.message.trim()) return candidate.error.message.trim();
    }
    return "";
}

function agnesVideoUrl(payload: AgnesVideoPayload) {
    for (const candidate of agnesCandidateRecords(payload)) {
        for (const key of ["video_url", "url"]) {
            const value = candidate[key];
            if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
        }
    }
    return "";
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; message?: string; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return readableGenerationError(responseData?.msg || responseData?.message || responseData?.error?.message || statusMessage(error.response?.status, fallback));
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

function readableGenerationError(message: string) {
    const raw = String(message || "");
    if (/content_policy_violation|content policy|内容安全|性感|挑逗|裸露|性暗示/i.test(raw)) return "内容安全策略拒绝了当前视频：请改为非暴露、非透视、无成人化表达的商品展示后重试。";
    if (/timed out|timeout|\b524\b/i.test(raw)) return "视频上游超时，请稍后重试。此次失败任务不会扣除积分。";
    return raw;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}
