import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Input, InputNumber, Select, Switch } from "antd";
import { ImagePlus, MapPinned, Package, Users, WandSparkles } from "lucide-react";

import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import { buildVideoScriptOptimizationPrompt, videoWorkflowFrameSize, type StudioWorkflowRunPayload, type VideoStudioWorkflowRunPayload } from "@/lib/canvas/canvas-workflows";
import { enabledVideoResolutions, modelPricingRules, normalizedVideoResolution } from "@/lib/studio-pricing";
import { isSeedanceFastModel, isSeedanceVideoConfig } from "@/lib/seedance-video";
import { requestImageQuestion } from "@/services/api/image";
import { modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { WorkflowFilePreviewGrid } from "./workflow-file-preview-grid";

type Props = {
    config: AiConfig;
    running: boolean;
    onRunningChange: (running: boolean) => void;
    onClose: () => void;
    onRun: (payload: StudioWorkflowRunPayload) => Promise<void>;
};

type UploadBucketProps = {
    inputRef: React.RefObject<HTMLInputElement | null>;
    label: string;
    hint: string;
    required?: boolean;
    files: File[];
    max: number;
    disabled: boolean;
    icon: React.ReactNode;
    onFiles: (files: FileList | null) => void;
    onRemove: (index: number) => void;
};

const STANDARD_VIDEO_SIZES = [
    { value: "1280x720", label: "16:9 横屏" },
    { value: "720x1280", label: "9:16 竖屏" },
    { value: "1024x1024", label: "1:1 方形" },
    { value: "1792x1024", label: "宽屏" },
    { value: "1024x1792", label: "长竖屏" },
];

const SEEDANCE_VIDEO_SIZES = [
    { value: "16:9", label: "16:9 横屏" },
    { value: "9:16", label: "9:16 竖屏" },
    { value: "1:1", label: "1:1 方形" },
    { value: "4:3", label: "4:3 横屏" },
    { value: "3:4", label: "3:4 竖屏" },
    { value: "21:9", label: "21:9 宽银幕" },
    { value: "adaptive", label: "自适应" },
];

const VIDEO_RESOLUTIONS = [
    { value: "480p", requestValue: "480", label: "480p" },
    { value: "720p", requestValue: "720", label: "720p" },
    { value: "1080p", requestValue: "1080", label: "1080p" },
    { value: "4k", requestValue: "4k", label: "4K" },
] as const;

export function CanvasVideoWorkflowForm({ config, running, onRunningChange, onClose, onRun }: Props) {
    const { message } = App.useApp();
    const characterInputRef = useRef<HTMLInputElement>(null);
    const objectInputRef = useRef<HTMLInputElement>(null);
    const sceneInputRef = useRef<HTMLInputElement>(null);
    const [characterFiles, setCharacterFiles] = useState<File[]>([]);
    const [objectFiles, setObjectFiles] = useState<File[]>([]);
    const [sceneFiles, setSceneFiles] = useState<File[]>([]);
    const [script, setScript] = useState("");
    const [extraRequirements, setExtraRequirements] = useState("");
    const [textModel, setTextModel] = useState(config.textModel || "");
    const [imageModel, setImageModel] = useState(config.imageModel || "");
    const [videoModel, setVideoModel] = useState(config.videoModel || "");
    const [syncGenerateVideo, setSyncGenerateVideo] = useState(true);
    const [videoSeconds, setVideoSeconds] = useState(config.videoSeconds || "6");
    const [videoResolution, setVideoResolution] = useState(config.vquality || "720");
    const [videoSize, setVideoSize] = useState(config.size || "1280x720");
    const [generateAudio, setGenerateAudio] = useState(config.videoGenerateAudio || "true");
    const [watermark, setWatermark] = useState(config.videoWatermark || "false");
    const [optimizing, setOptimizing] = useState(false);

    const textModels = selectableModelsByCapability(config, "text");
    const imageModels = selectableModelsByCapability(config, "image");
    const videoModels = selectableModelsByCapability(config, "video");
    const videoRequestConfig = { ...config, model: videoModel, videoModel };
    const seedance = Boolean(videoModel && isSeedanceVideoConfig(videoRequestConfig));
    const fastSeedance = seedance && isSeedanceFastModel(modelOptionName(videoModel));
    const videoSizeOptions = seedance ? SEEDANCE_VIDEO_SIZES : STANDARD_VIDEO_SIZES;
    const configuredResolutions = videoModel ? enabledVideoResolutions(modelPricingRules(config.modelPricingRules, videoModel)) : [];
    const resolutionOptions = VIDEO_RESOLUTIONS.map((item) => ({
        ...item,
        disabled: !configuredResolutions.includes(item.value) || (seedance && item.value === "4k") || (fastSeedance && item.value === "1080p"),
    }));
    const enabledResolutionOptions = resolutionOptions.filter((item) => !item.disabled);
    const maxSeconds = seedance ? 15 : 18;
    const minSeconds = seedance ? 4 : 1;

    useEffect(() => {
        if (!textModels.includes(textModel)) setTextModel(config.textModel || textModels[0] || "");
        if (!imageModels.includes(imageModel)) setImageModel(config.imageModel || imageModels[0] || "");
        if (!videoModels.includes(videoModel)) setVideoModel(config.videoModel || videoModels[0] || "");
    }, [config.imageModel, config.textModel, config.videoModel, imageModel, imageModels, textModel, textModels, videoModel, videoModels]);

    const resolutionSignature = enabledResolutionOptions.map((item) => item.requestValue).join(",");
    useEffect(() => {
        if (!enabledResolutionOptions.length) return;
        const current = normalizedVideoResolution(videoResolution);
        const matched = enabledResolutionOptions.find((item) => item.value === current);
        if (!matched) setVideoResolution(enabledResolutionOptions[0].requestValue);
        else if (matched.requestValue !== videoResolution) setVideoResolution(matched.requestValue);
    }, [resolutionSignature, videoResolution]);

    const sizeSignature = videoSizeOptions.map((item) => item.value).join(",");
    useEffect(() => {
        if (!videoSizeOptions.some((item) => item.value === videoSize)) setVideoSize(videoSizeOptions[0].value);
    }, [sizeSignature, videoSize]);

    useEffect(() => {
        const seconds = Math.max(minSeconds, Math.min(maxSeconds, Math.floor(Number(videoSeconds) || minSeconds)));
        if (String(seconds) !== videoSeconds) setVideoSeconds(String(seconds));
    }, [maxSeconds, minSeconds, videoSeconds]);

    const imageOptionList = imageModels.map((value) => ({ value, label: modelOptionName(value) }));
    const videoOptionList = videoModels.map((value) => ({ value, label: modelOptionName(value) }));
    const textOptionList = textModels.map((value) => ({ value, label: modelOptionName(value) }));
    const frameSize = videoWorkflowFrameSize(videoSize);
    const nineViewCredits = imageModel
        ? requestCreditCost({
              channelMode: config.channelMode,
              modelCosts: config.modelCosts,
              modelPricingRules: config.modelPricingRules,
              model: imageModel,
              capability: "image",
              count: characterFiles.length,
              quality: config.quality,
              size: config.size,
              imageResolution: config.imageResolution,
          })
        : 0;
    const frameCredits = imageModel
        ? requestCreditCost({
              channelMode: config.channelMode,
              modelCosts: config.modelCosts,
              modelPricingRules: config.modelPricingRules,
              model: imageModel,
              capability: "image",
              count: 2,
              quality: config.quality,
              size: frameSize,
              imageResolution: config.imageResolution,
          })
        : 0;
    const videoCredits =
        syncGenerateVideo && videoModel
            ? requestCreditCost({ channelMode: config.channelMode, modelCosts: config.modelCosts, modelPricingRules: config.modelPricingRules, model: videoModel, capability: "video", seconds: videoSeconds, vquality: videoResolution })
            : 0;
    const optimizeCredits = textModel ? requestCreditCost({ channelMode: config.channelMode, modelCosts: config.modelCosts, modelPricingRules: config.modelPricingRules, model: textModel, capability: "text" }) : 0;
    const estimatedCredits = nineViewCredits + frameCredits + videoCredits;

    const optimizeScript = async () => {
        if (!script.trim()) {
            message.warning("请先填写视频文案");
            return;
        }
        if (!textModel) {
            message.warning("请选择文字模型");
            return;
        }
        setOptimizing(true);
        try {
            let streamed = "";
            const answer = await requestImageQuestion({ ...config, model: textModel, textModel }, [{ role: "user", content: buildVideoScriptOptimizationPrompt(script, extraRequirements) }], (text) => {
                streamed = text;
            });
            const optimized = (answer || streamed).trim();
            if (!optimized || optimized === "未返回文本内容") throw new Error("文字模型没有返回优化结果");
            setScript(optimized);
            message.success("视频文案已优化");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频文案优化失败");
        } finally {
            setOptimizing(false);
        }
    };

    const run = async () => {
        if (!characterFiles.length) {
            message.warning("请至少上传 1 张角色图片");
            return;
        }
        if (characterFiles.length > 8) {
            message.warning("角色最多 8 个，每张图片代表一个角色");
            return;
        }
        if (!script.trim()) {
            message.warning("请填写视频文案");
            return;
        }
        if (!textModel || !imageModel || (syncGenerateVideo && !videoModel)) {
            message.warning(syncGenerateVideo ? "请完整选择文字、图片和视频模型" : "请完整选择文字和图片模型");
            return;
        }
        if (syncGenerateVideo && !enabledResolutionOptions.length) {
            message.warning("该视频模型没有已启用的清晰度，请联系管理员配置");
            return;
        }

        const payload: VideoStudioWorkflowRunPayload = {
            workflowKey: "video-suite",
            characterFiles,
            objectFiles,
            sceneFiles,
            script: script.trim(),
            extraRequirements: extraRequirements.trim(),
            textModel,
            imageModel,
            videoModel,
            syncGenerateVideo,
            imageQuality: config.quality,
            imageSize: config.size,
            imageResolution: config.imageResolution,
            videoSeconds,
            videoResolution,
            videoSize,
            generateAudio,
            watermark,
            config,
        };
        onRunningChange(true);
        onClose();
        try {
            await onRun(payload);
            message.success(syncGenerateVideo ? `视频工作流已完成：${characterFiles.length} 张角色九视图、首尾帧和最终视频` : `图片阶段已完成：${characterFiles.length} 张角色九视图与首尾帧；最终视频节点已留在画布中等待验收后生成`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频工作流执行失败");
        } finally {
            message.destroy("video-suite-progress");
            onRunningChange(false);
        }
    };

    return (
        <div className="space-y-5">
            <Alert
                type="info"
                showIcon
                message={syncGenerateVideo ? `将按顺序生成 ${characterFiles.length || 1} 张角色九视图、视频头帧、视频尾帧和 1 条成片` : `将先生成 ${characterFiles.length || 1} 张角色九视图与视频首尾帧；最终视频配置会保留在画布中`}
                description={
                    syncGenerateVideo
                        ? "每张角色图代表一个独立角色。制作参考总览会合并全部角色、物品与场景，避免供应商参考图数量上限造成素材丢失。"
                        : "关闭同步生成视频后不要求选择视频模型，也不会扣除视频积分。请验收九视图和首尾帧后，在画布的“最终视频”配置节点选择模型并点击生成。"
                }
            />

            <section className="grid gap-3 lg:grid-cols-3">
                <UploadBucket
                    inputRef={characterInputRef}
                    label="角色图片"
                    hint="每张图代表一个角色，1-8 张"
                    required
                    files={characterFiles}
                    max={8}
                    disabled={running}
                    icon={<Users className="size-5" />}
                    onFiles={(files) => addImageFiles(files, 8, characterInputRef, setCharacterFiles)}
                    onRemove={(index) => setCharacterFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                />
                <UploadBucket
                    inputRef={objectInputRef}
                    label="物品图片"
                    hint="可选，上传后必须在成片中出现"
                    files={objectFiles}
                    max={8}
                    disabled={running}
                    icon={<Package className="size-5" />}
                    onFiles={(files) => addImageFiles(files, 8, objectInputRef, setObjectFiles)}
                    onRemove={(index) => setObjectFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                />
                <UploadBucket
                    inputRef={sceneInputRef}
                    label="场景图片"
                    hint="可选，上传后锁定成片场景"
                    files={sceneFiles}
                    max={8}
                    disabled={running}
                    icon={<MapPinned className="size-5" />}
                    onFiles={(files) => addImageFiles(files, 8, sceneInputRef, setSceneFiles)}
                    onRemove={(index) => setSceneFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                />
            </section>

            <section className="grid gap-3 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1.5 flex items-center justify-between gap-3 text-sm font-medium text-stone-800 dark:text-stone-200">
                        <span>
                            视频文案 <span className="text-red-500">*</span>
                        </span>
                        <Button size="small" icon={<WandSparkles className="size-3.5" />} loading={optimizing} disabled={running || !script.trim() || !textModel} onClick={() => void optimizeScript()}>
                            一键优化{optimizeCredits > 0 ? ` · ${optimizeCredits.toFixed(2)} 积分` : ""}
                        </Button>
                    </span>
                    <Input.TextArea value={script} rows={7} maxLength={8000} showCount disabled={running} placeholder="角色要做什么、场景如何变化、镜头如何运动、最终如何收束..." onChange={(event) => setScript(event.target.value)} />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">额外要求</span>
                    <Input.TextArea
                        value={extraRequirements}
                        rows={7}
                        maxLength={4000}
                        showCount
                        disabled={running}
                        placeholder="必须保留的服装、物品使用方式、镜头禁区、动作节奏、品牌规范等..."
                        onChange={(event) => setExtraRequirements(event.target.value)}
                    />
                </label>
            </section>

            <section className="grid gap-3 md:grid-cols-3">
                <ModelSelect label="文字模型" value={textModel} options={textOptionList} disabled={running || optimizing} onChange={setTextModel} />
                <ModelSelect label="图片模型" value={imageModel} options={imageOptionList} disabled={running} onChange={setImageModel} />
                <ModelSelect label={syncGenerateVideo ? "视频模型" : "视频模型（可后续选择）"} value={videoModel} options={videoOptionList} disabled={running} onChange={setVideoModel} />
            </section>

            <section className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                <Toggle label="同步生成视频" checked={syncGenerateVideo} disabled={running} onChange={setSyncGenerateVideo} />
                <p className="mt-1 text-xs text-stone-500">关闭后仅自动生成角色九视图、制作参考总览和视频首尾帧；最终视频节点会保留在画布中，验收图片后可自行选择视频模型并继续生成。</p>
            </section>

            <section className="grid gap-3 md:grid-cols-4">
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">视频时长</span>
                    <InputNumber
                        className="w-full"
                        min={minSeconds}
                        max={maxSeconds}
                        value={Number(videoSeconds)}
                        disabled={running || !syncGenerateVideo}
                        addonAfter="秒"
                        onChange={(value) => setVideoSeconds(String(Math.max(minSeconds, Math.min(maxSeconds, Number(value || minSeconds)))))}
                    />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">清晰度</span>
                    <Select
                        className="w-full"
                        value={videoResolution || undefined}
                        options={resolutionOptions.map((item) => ({ value: item.requestValue, label: item.label, disabled: item.disabled }))}
                        disabled={running || !syncGenerateVideo || !enabledResolutionOptions.length}
                        onChange={setVideoResolution}
                    />
                </label>
                <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">画幅</span>
                    <Select className="w-full" value={videoSize || undefined} options={videoSizeOptions} disabled={running || !syncGenerateVideo} onChange={setVideoSize} />
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                    <Toggle label="声音" checked={generateAudio === "true"} disabled={running || !syncGenerateVideo} onChange={(checked) => setGenerateAudio(String(checked))} />
                    <Toggle label="水印" checked={watermark === "true"} disabled={running || !syncGenerateVideo} onChange={(checked) => setWatermark(String(checked))} />
                </div>
            </section>

            <section className="flex flex-wrap items-center justify-between gap-3 border-y border-stone-200 py-3 dark:border-stone-800">
                <div className="text-xs text-stone-500">
                    九视图 {nineViewCredits.toFixed(2)} + 首尾帧 {frameCredits.toFixed(2)}
                    {syncGenerateVideo ? ` + 视频 ${videoCredits.toFixed(2)}` : "（视频暂不生成）"}
                </div>
                <div className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-300">
                    预计 <CreditSymbol /> {estimatedCredits.toFixed(2)} 积分
                </div>
            </section>

            {running ? <Alert type="warning" showIcon message={syncGenerateVideo ? "正在按九视图、头帧、尾帧、成片的顺序执行，请勿关闭页面。" : "正在生成九视图、头帧和尾帧，请勿关闭页面。"} /> : null}

            <footer className="flex items-center justify-end gap-2 pt-1">
                <Button disabled={running || optimizing} onClick={onClose}>
                    取消
                </Button>
                <Button type="primary" icon={<WandSparkles className="size-4" />} loading={running} disabled={optimizing} onClick={() => void run()}>
                    {syncGenerateVideo ? "创建并生成" : "创建图片工作流"}
                </Button>
            </footer>
        </div>
    );
}

function UploadBucket({ inputRef, label, hint, required, files, max, disabled, icon, onFiles, onRemove }: UploadBucketProps) {
    return (
        <div className="min-w-0">
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => onFiles(event.target.files)} />
            <button
                type="button"
                disabled={disabled}
                className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 text-center text-sm text-stone-600 transition hover:border-stone-500 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-white"
                onClick={() => inputRef.current?.click()}
            >
                <span className="inline-flex items-center gap-2 font-medium">
                    {icon}
                    {label}
                    {required ? <span className="text-red-500">*</span> : null}
                </span>
                <span className="text-xs text-stone-500">{hint}</span>
                <span className="text-xs tabular-nums">
                    {files.length}/{max}
                </span>
            </button>
            {files.length ? <WorkflowFilePreviewGrid files={files} disabled={disabled} maxHeightClassName="max-h-72" onRemove={onRemove} /> : null}
        </div>
    );
}

function ModelSelect({ label, value, options, disabled, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; disabled: boolean; onChange: (value: string) => void }) {
    return (
        <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">{label}</span>
            <Select className="w-full" showSearch optionFilterProp="label" value={value || undefined} options={options} disabled={disabled} onChange={onChange} />
        </label>
    );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className="flex min-w-0 flex-col items-center justify-center gap-1 text-xs text-stone-600 dark:text-stone-300">
            <span>{label}</span>
            <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
        </label>
    );
}

function addImageFiles(nextFiles: FileList | null, max: number, inputRef: React.RefObject<HTMLInputElement | null>, setter: React.Dispatch<React.SetStateAction<File[]>>) {
    const accepted = Array.from(nextFiles || []).filter((file) => file.type.startsWith("image/"));
    setter((current) => [...current, ...accepted].slice(0, max));
    if (inputRef.current) inputRef.current.value = "";
}
