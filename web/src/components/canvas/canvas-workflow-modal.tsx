import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Empty, Input, InputNumber, Modal, Segmented, Select, Switch, Tag } from "antd";
import { Clapperboard, ImagePlus, PackageSearch, Shirt, Trash2, WandSparkles } from "lucide-react";

import { CreditSymbol, requestCreditCost } from "@/constant/credits";
import {
    ECOMMERCE_OUTPUTS,
    FASHION_OUTPUTS,
    type StudioWorkflowKey,
    type StudioWorkflowOutput,
    type StudioWorkflowOutputType,
    type StudioWorkflowRunPayload,
} from "@/lib/canvas/canvas-workflows";
import { fetchStudioWorkflows, type StudioWorkflow } from "@/services/studio-managed";
import { modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { CanvasVideoWorkflowForm } from "./canvas-video-workflow-form";

type Props = {
    open: boolean;
    config: AiConfig;
    onClose: () => void;
    onRun: (payload: StudioWorkflowRunPayload) => Promise<void>;
};

const DEFAULT_COUNTS: Record<StudioWorkflowOutputType, number> = {
    "main-image": 0,
    "sku-image": 0,
    "detail-image": 0,
    "product-scene": 0,
    "model-image": 0,
    "new-design": 0,
    colorway: 0,
    "nine-grid": 0,
};

export function CanvasWorkflowModal({ open, config, onClose, onRun }: Props) {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const runningRef = useRef(false);
    const [workflows, setWorkflows] = useState<StudioWorkflow[]>([]);
    const [workflowKey, setWorkflowKey] = useState<StudioWorkflowKey>("ecommerce-suite");
    const [loadingAccess, setLoadingAccess] = useState(false);
    const [running, setRunning] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [description, setDescription] = useState("");
    const [extraRequirements, setExtraRequirements] = useState("");
    const [counts, setCounts] = useState<Record<StudioWorkflowOutputType, number>>(DEFAULT_COUNTS);
    const [model, setModel] = useState(config.imageModel || config.model || "");
    const [platform, setPlatform] = useState("通用跨境电商");
    const [targetMarket, setTargetMarket] = useState("");
    const [language, setLanguage] = useState("中文");
    const [category, setCategory] = useState("鞋类");
    const [referencePriority, setReferencePriority] = useState<"high" | "medium" | "low">("high");
    const [strictConsistency, setStrictConsistency] = useState(true);

    useEffect(() => {
        if (!open) return;
        setLoadingAccess(true);
        void fetchStudioWorkflows()
            .then((items) => {
                setWorkflows(items);
                if (items.length) setWorkflowKey((current) => (items.some((item) => item.key === current) ? current : items[0].key));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "工作流权限加载失败"))
            .finally(() => setLoadingAccess(false));
    }, [message, open]);

    useEffect(() => {
        if (!open) return;
        const options = selectableModelsByCapability(config, "image");
        if (!options.includes(model)) setModel(config.imageModel || options[0] || "");
    }, [config, model, open]);

    const outputOptions = workflowKey === "ecommerce-suite" ? ECOMMERCE_OUTPUTS : FASHION_OUTPUTS;
    const selectedOutputs: StudioWorkflowOutput[] = outputOptions.map((item) => ({ type: item.value, count: counts[item.value] || 0 })).filter((item) => item.count > 0);
    const totalImages = selectedOutputs.reduce((sum, item) => sum + item.count, 0);
    const estimatedCredits = model
        ? requestCreditCost({ channelMode: config.channelMode, modelCosts: config.modelCosts, modelPricingRules: config.modelPricingRules, model, capability: "image", count: totalImages, quality: config.quality, size: config.size })
        : 0;
    const modelOptions = selectableModelsByCapability(config, "image").map((value) => ({ value, label: modelOptionName(value) }));

    const run = async () => {
        if (runningRef.current) return;
        if (workflowKey === "video-suite") return;
        if (!files.length) {
            message.warning("请至少上传一张原图素材");
            return;
        }
        if (!description.trim()) {
            message.warning("请填写产品或设计描述");
            return;
        }
        if (!selectedOutputs.length) {
            message.warning("请至少选择一种要生成的图片");
            return;
        }
        if (!model) {
            message.warning("请选择图片模型");
            return;
        }
        runningRef.current = true;
        setRunning(true);
        onClose();
        try {
            await onRun({
                workflowKey,
                files,
                description,
                extraRequirements,
                outputs: selectedOutputs,
                model,
                quality: config.quality,
                size: config.size,
                platform,
                targetMarket,
                language,
                category,
                referencePriority,
                strictConsistency,
                config,
            });
            message.success(`已创建工作流并完成 ${totalImages} 张图片任务`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "工作流执行失败");
        } finally {
            runningRef.current = false;
            setRunning(false);
        }
    };

    const addFiles = (nextFiles: FileList | null) => {
        const accepted = Array.from(nextFiles || []).filter((file) => file.type.startsWith("image/"));
        setFiles((current) => [...current, ...accepted].slice(0, 12));
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <Modal title={null} open={open} onCancel={running ? undefined : onClose} footer={null} width={920} centered destroyOnHidden maskClosable={!running}>
            <div className="flex max-h-[82vh] min-h-0 flex-col overflow-hidden">
                <header className="border-b border-stone-200 px-1 pb-4 dark:border-stone-800">
                    <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950">
                            <WandSparkles className="size-5" />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-lg font-semibold text-stone-950 dark:text-stone-100">行业生成工作流</h2>
                            <p className="mt-1 text-sm text-stone-500">选择套组并提交素材，所有中间结果与最终产物都会放入当前画布。</p>
                        </div>
                    </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
                    {loadingAccess ? <div className="py-16 text-center text-sm text-stone-500">正在读取工作流权限...</div> : null}
                    {!loadingAccess && !workflows.length ? <Empty description="当前账号暂未开放行业工作流" /> : null}
                    {!loadingAccess && workflows.length ? (
                        <div className="space-y-5">
                            <Segmented<StudioWorkflowKey>
                                block
                                value={workflowKey}
                                onChange={setWorkflowKey}
                                options={workflows.map((item) => ({
                                    value: item.key,
                                    label: (
                                        <span className="inline-flex items-center gap-2 px-2 py-1">
                                            {item.key === "ecommerce-suite" ? <PackageSearch className="size-4" /> : item.key === "fashion-suite" ? <Shirt className="size-4" /> : <Clapperboard className="size-4" />}
                                            {item.name}
                                        </span>
                                    ),
                                }))}
                            />

                            {workflowKey === "video-suite" ? (
                                <CanvasVideoWorkflowForm config={config} running={running} onRunningChange={setRunning} onClose={onClose} onRun={onRun} />
                            ) : (
                                <>
                            <section>
                                <div className="mb-2 text-sm font-medium text-stone-800 dark:text-stone-200">原图素材</div>
                                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
                                <button
                                    type="button"
                                    className="flex min-h-24 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 text-sm text-stone-600 transition hover:border-stone-500 hover:text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-white"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <ImagePlus className="size-5" />
                                    上传产品、款式、鞋底、商标或辅助参考图
                                </button>
                                {files.length ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {files.map((file, index) => (
                                            <Tag key={`${file.name}-${file.lastModified}-${index}`} closable={!running} onClose={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} closeIcon={<Trash2 className="size-3" />}>
                                                {file.name}
                                            </Tag>
                                        ))}
                                    </div>
                                ) : null}
                            </section>

                            <section className="grid gap-3 md:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">产品或设计描述</span>
                                    <Input.TextArea value={description} rows={4} maxLength={3000} showCount placeholder="产品是什么、核心结构、材质、卖点、希望形成的视觉方向..." onChange={(event) => setDescription(event.target.value)} />
                                </label>
                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">额外要求</span>
                                    <Input.TextArea value={extraRequirements} rows={4} maxLength={3000} showCount placeholder="必须保留或修改的细节、禁止项、场景、文案、构图等..." onChange={(event) => setExtraRequirements(event.target.value)} />
                                </label>
                            </section>

                            <section>
                                <div className="mb-2 flex items-end justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-medium text-stone-800 dark:text-stone-200">产物与张数</div>
                                        <div className="mt-0.5 text-xs text-stone-500">不预设固定组合，只生成你开启的项目。</div>
                                    </div>
                                    <Tag color="blue">共 {totalImages} 张</Tag>
                                </div>
                                <div className="divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                                    {outputOptions.map((item) => {
                                        const enabled = counts[item.value] > 0;
                                        return (
                                            <div key={item.value} className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_100px] items-center gap-3 px-3">
                                                <Switch checked={enabled} onChange={(checked) => setCounts((current) => ({ ...current, [item.value]: checked ? 1 : 0 }))} />
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-stone-800 dark:text-stone-200">{item.label}</div>
                                                    <div className="truncate text-xs text-stone-500">{item.hint}</div>
                                                </div>
                                                <InputNumber className="w-full" min={1} max={12} disabled={!enabled} value={enabled ? counts[item.value] : 1} addonAfter="张" onChange={(value) => setCounts((current) => ({ ...current, [item.value]: Math.max(1, Math.min(12, Number(value || 1))) }))} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>

                            <section className="grid gap-3 md:grid-cols-3">
                                <label className="block md:col-span-2">
                                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">图片模型</span>
                                    <Select className="w-full" showSearch optionFilterProp="label" value={model || undefined} options={modelOptions} onChange={setModel} />
                                </label>
                                <div>
                                    <span className="mb-1.5 block text-sm font-medium text-stone-800 dark:text-stone-200">预计积分</span>
                                    <div className="flex h-8 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-medium tabular-nums text-amber-600 dark:border-stone-800 dark:text-amber-300">
                                        <CreditSymbol /> {estimatedCredits.toFixed(2)}
                                    </div>
                                </div>
                            </section>

                            {workflowKey === "ecommerce-suite" ? (
                                <section className="grid gap-3 md:grid-cols-3">
                                    <Select value={platform} onChange={setPlatform} options={["通用跨境电商", "Amazon", "TikTok Shop", "Shopee", "Temu", "AliExpress", "1688 / Alibaba", "淘宝", "拼多多", "抖音", "小红书", "京东", "SHEIN", "美客多"].map((value) => ({ value, label: value }))} />
                                    <Input value={targetMarket} placeholder="目标国家/市场" onChange={(event) => setTargetMarket(event.target.value)} />
                                    <Input value={language} placeholder="画面文字语言" onChange={(event) => setLanguage(event.target.value)} />
                                </section>
                            ) : (
                                <section className="grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-center">
                                    <Select value={category} onChange={setCategory} options={["鞋类", "服装", "箱包"].map((value) => ({ value, label: value }))} />
                                    <Segmented value={referencePriority} onChange={setReferencePriority} options={[{ value: "high", label: "高参考" }, { value: "medium", label: "中参考" }, { value: "low", label: "创意优先" }]} />
                                    <span className="inline-flex items-center justify-between gap-3 text-sm text-stone-600 dark:text-stone-300">
                                        批次一致
                                        <Switch checked={strictConsistency} onChange={setStrictConsistency} />
                                    </span>
                                </section>
                            )}

                            {workflowKey === "fashion-suite" && selectedOutputs.some((item) => item.type === "new-design" || item.type === "colorway") ? (
                                <Alert type="info" showIcon message="新款设计和新配色会自动在右上角加入主要颜色的 PANTONE 参考色卡与色号。" />
                            ) : null}
                                </>
                            )}
                        </div>
                    ) : null}
                </div>

                {workflows.length && workflowKey !== "video-suite" ? (
                    <footer className="flex items-center justify-end gap-2 border-t border-stone-200 px-1 pt-4 dark:border-stone-800">
                        <Button disabled={running} onClick={onClose}>取消</Button>
                        <Button type="primary" icon={<WandSparkles className="size-4" />} loading={running} onClick={() => void run()}>
                            创建并生成
                        </Button>
                    </footer>
                ) : null}
            </div>
        </Modal>
    );
}
