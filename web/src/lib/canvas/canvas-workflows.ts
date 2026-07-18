import type { AiConfig } from "@/stores/use-config-store";

export type StudioWorkflowKey = "ecommerce-suite" | "fashion-suite" | "video-suite";
export type ImageStudioWorkflowKey = Exclude<StudioWorkflowKey, "video-suite">;
export type EcommerceOutputType = "main-image" | "sku-image" | "detail-image" | "product-scene" | "model-image";
export type FashionOutputType = "new-design" | "colorway" | "nine-grid" | "model-image";
export type StudioWorkflowOutputType = EcommerceOutputType | FashionOutputType;

export type StudioWorkflowOutput = {
    type: StudioWorkflowOutputType;
    count: number;
};

export type ImageStudioWorkflowRunPayload = {
    workflowKey: ImageStudioWorkflowKey;
    files: File[];
    description: string;
    extraRequirements: string;
    outputs: StudioWorkflowOutput[];
    model: string;
    quality: string;
    size: string;
    platform: string;
    targetMarket: string;
    language: string;
    category: string;
    referencePriority: "high" | "medium" | "low";
    strictConsistency: boolean;
    config: AiConfig;
};

export type VideoStudioWorkflowRunPayload = {
    workflowKey: "video-suite";
    characterFiles: File[];
    objectFiles: File[];
    sceneFiles: File[];
    script: string;
    extraRequirements: string;
    textModel: string;
    imageModel: string;
    videoModel: string;
    syncGenerateVideo: boolean;
    imageQuality: string;
    imageSize: string;
    videoSeconds: string;
    videoResolution: string;
    videoSize: string;
    generateAudio: string;
    watermark: string;
    config: AiConfig;
};

export type StudioWorkflowRunPayload = ImageStudioWorkflowRunPayload | VideoStudioWorkflowRunPayload;

export const ECOMMERCE_OUTPUTS: Array<{ value: EcommerceOutputType; label: string; hint: string }> = [
    { value: "main-image", label: "主图", hint: "清晰聚焦商品，适合平台首图" },
    { value: "sku-image", label: "SKU 图", hint: "规格、颜色或组合差异清晰可辨" },
    { value: "detail-image", label: "A+详情图", hint: "每张均为完整多模块产品故事页" },
    { value: "product-scene", label: "产品图", hint: "商业静物或可信使用场景" },
    { value: "model-image", label: "模特图", hint: "真人展示商品穿戴或使用效果" },
];

export const FASHION_OUTPUTS: Array<{ value: FashionOutputType; label: string; hint: string }> = [
    { value: "new-design", label: "新款设计", hint: "结构、轮廓和细节形成可辨识新款" },
    { value: "colorway", label: "新款配色", hint: "锁定版型结构，只改变配色与兼容材质" },
    { value: "nine-grid", label: "九宫格图", hint: "同一款式的多角度与细节 3x3 组合" },
    { value: "model-image", label: "模特图", hint: "同一款式的真实穿搭展示" },
];

export function workflowOutputLabel(type: StudioWorkflowOutputType) {
    return [...ECOMMERCE_OUTPUTS, ...FASHION_OUTPUTS].find((item) => item.value === type)?.label || type;
}

export function workflowNeedsPantoneCard(type: StudioWorkflowOutputType) {
    return type === "new-design" || type === "colorway";
}

export function buildWorkflowPrompt(payload: ImageStudioWorkflowRunPayload, output: StudioWorkflowOutput, variantIndex = 0, variantTotal = 1) {
    const brief = [
        `产品描述：${payload.description.trim()}`,
        payload.extraRequirements.trim() ? `额外要求：${payload.extraRequirements.trim()}` : "",
        payload.targetMarket.trim() ? `目标市场：${payload.targetMarket.trim()}` : "",
        payload.language.trim() ? `画面文字语言：${payload.language.trim()}` : "",
    ]
        .filter(Boolean)
        .join("\n");
    return payload.workflowKey === "ecommerce-suite" ? ecommercePrompt(payload, output, brief, variantIndex, variantTotal) : fashionPrompt(payload, output, brief);
}

export function buildWorkflowSafetyRetryPrompt(prompt: string, workflowKey: StudioWorkflowKey) {
    const productFacts = prompt
        .replace(/性感|诱惑|挑逗|露骨|性暗示|性化|裸体|裸露|透视|透明|薄纱|情趣|sexy|seductive|lingerie|sheer|transparent|nude/gi, "")
        .replace(/\s{2,}/g, " ")
        .slice(0, 2600);
    const workflowLabel = workflowKey === "video-suite" ? "视频制作参考图" : workflowKey === "fashion-suite" ? "鞋服箱包商品图" : "电商商品图";
    return `这是一次因内容安全策略触发的合规商业重试。请生成 ${workflowLabel}，仅保留以下可验证的商品事实与商业目标：\n${productFacts}\n\n强制改为商品目录展示：无人物、无身体局部、无姿态暗示；使用平铺、挂拍、人体模特、服装人台或中性产品陈列；服装必须完整、得体、不透视、不透明；画面强调版型、颜色、材质、工艺、规格、包装和真实使用价值。不得出现裸露、内衣展示、性感、挑逗或成人化表达。输出一张适合正常电商审核的完整商品图。`;
}

export function buildWorkflowSafetyInitialPrompt(prompt: string, workflowKey: StudioWorkflowKey) {
    const workflowLabel = workflowKey === "video-suite" ? "视频制作参考图" : workflowKey === "fashion-suite" ? "鞋服箱包商品图" : "电商商品图";
    return `内容安全与商业展示要求：这是正常的 ${workflowLabel} 任务。只表现商品设计、版型、材质、颜色、工艺和使用价值；人物必须明确为成年人，姿态自然中性，不强调身体曲线，不出现裸露、透视或成人化表达。若商品属于贴身服饰或睡衣，优先采用平铺、挂拍、服装人台或完整得体穿着的成年模特，保持原商品身份与结构，不擅自改款。\n\n${prompt}`;
}

function ecommercePrompt(payload: ImageStudioWorkflowRunPayload, output: StudioWorkflowOutput, brief: string, variantIndex: number, variantTotal: number) {
    const aPlusLayouts = [
        "主视觉占约 42% 画面，其余五个内容模块沿清晰阅读路径分布；整体留白充足，适合移动端快速扫描。",
        "采用不对称双栏叙事：产品主视觉与使用场景形成主次，两组细节/材质/规格模块作为有序支撑。",
        "采用横向产品故事结构：核心价值主画面、功能证明、材质细节、使用场景、规格或包装依次形成连续阅读路径。",
        "采用高端画册式网格：一个主产品画面加五个大小不等的事实证明模块，禁止等权重复拼贴。",
    ];
    const purpose: Record<EcommerceOutputType, string> = {
        "main-image": "生成电商主图：商品占画面主体，移动端缩略图仍清晰；使用白色或接近白色背景，商业摄影光线，避免大段文字、促销贴纸、平台徽章和水印。",
        "sku-image": "生成 SKU 图：保持同一商品身份，清楚表达用户描述中真实存在的规格、颜色或组合差异；画面简洁有秩序，不虚构 SKU、包装内容或配件。",
        "detail-image": `生成一张完整的 A+ 详情图，不是只展示一个卖点的普通详情页，也不是把一个模块拆给其他图片。单张内必须同时包含：1) 商品与核心价值主视觉；2) 至少一个真实可见的卖点或功能证明；3) 材质、工艺或结构细节；4) 可信使用场景或尺度感；5) 已验证的规格、容量、适配或包装内容（资料不足时改为无文字的真实视觉证明，绝不编造）；6) 收束性的购买信心模块。所有模块服务于同一 SKU，形成一张可直接用于 A+ 页面的一体化产品故事板。版式变体 ${variantIndex + 1}/${variantTotal}：${aPlusLayouts[variantIndex % aPlusLayouts.length]}`,
        "product-scene": "生成商业产品图：同一商品作为唯一主角，使用可信静物布景或真实使用场景，通过构图、光线和材质表现突出一个真实卖点，不增加无依据功能。",
        "model-image": "生成模特展示图：模特自然穿戴或使用同一商品，商品结构、比例、材质、颜色、商标位置和可见细节必须与参考图一致，姿态与场景服务于商品展示。",
    };
    return `你正在执行电商生图套组。请把全部上传图片视为同一商品/SKU的事实来源。

${brief}
平台：${payload.platform || "通用跨境电商"}
参考优先级：${payload.referencePriority}
产物：${workflowOutputLabel(output.type)}，本组计划生成 ${output.count} 张。

${purpose[output.type as EcommerceOutputType]}

必须严格保持商品类别、轮廓、比例、结构线、接缝、饰边、闭合方式、把手、纽扣、标签、包装形状、配件、材质、纹理、色块、图案、表面处理和可见商标位置。只允许改变构图、裁切、镜头、光线、背景、阴影、版式和可信场景。不得替换成相似商品，不得虚构品牌、认证、折扣、奖项、医疗或性能声明，不得混入其他 SKU。

使用可执行的商业美术指导：明确主体位置与占比、阅读路径、前中后景、镜头焦段、景深、主光/补光/轮廓光、阴影和材质高光。A+详情图的多个模块必须有主次层级与不同信息密度，不得重复同一角度、同一句卖点或同一构图；只允许使用简短、真实且可从参考图或用户描述验证的画面文字，避免密集小字。输出一张完整可用的最终图片，不要输出说明文字或提示词。`;
}

function fashionPrompt(payload: ImageStudioWorkflowRunPayload, output: StudioWorkflowOutput, brief: string) {
    const isColorway = output.type === "colorway";
    const purpose: Record<FashionOutputType, string> = {
        "new-design": "生成一个明显的新款设计：在保留参考图设计语言和用户指定约束的前提下，轮廓、结构、分片布局和细节必须形成可辨识的新方向，不能只做轻微改色。",
        colorway: "生成新款配色：严格锁定原款轮廓、结构、分片、比例、鞋底/五金/版型和身份，只改变用户要求的颜色及兼容材质，不改变产品构造。",
        "nine-grid": "生成一张完整的 3x3 九宫格组合图，不是九个文件。九格必须展示同一个款式，可包含正面、侧面、背面、45度、顶部/底部、材质特写、结构特写、包装或穿搭尺度；浅色整洁背景，避免无关道具。",
        "model-image": "生成模特图：模特自然展示同一个鞋服箱包款式，产品轮廓、版型、结构、图案、材质、配色、五金、鞋底和商标保持一致，服装穿着逻辑与人体比例真实。",
    };
    const pantone = workflowNeedsPantoneCard(output.type)
        ? "构图时在右上角预留约 28% 的安静区域，最终系统会叠加主要颜色的 PANTONE 参考色卡和色号；产品主体、模特、商标和关键细节不得进入该区域。"
        : "";
    return `你正在执行鞋服箱包生图套组。全部上传图片共同提供款式、鞋底、版型、材质、结构、五金、商标、纹理、配色和风格线索。

${brief}
品类：${payload.category || "鞋服箱包"}
参考优先级：${payload.referencePriority}
严格批次一致性：${payload.strictConsistency ? "开启" : "关闭"}
模式：${isColorway ? "same_colorways" : output.type === "new-design" ? "new_style" : "presentation"}
产物：${workflowOutputLabel(output.type)}，本组计划生成 ${output.count} 张。

${purpose[output.type as FashionOutputType]}
${pantone}

若参考中包含鞋底底面或侧面，必须把鞋底几何、纹路、厚度、侧墙、纹理和模压细节作为硬约束，除非用户明确要求，否则只能改色。客户商标必须原样保留且与辅助风格线索分开；不得复制第三方商标。严格一致性只约束同批新款保持统一，不能把新款设计退化成复制原款。

使用真实产品设计与商业摄影语言，明确主体位置、镜头、光线、材质和场景。输出一张完整可用的最终图片，不要输出解释、JSON 或提示词。`;
}

export function buildVideoScriptOptimizationPrompt(script: string, extraRequirements: string) {
    return `你是商业短视频导演。请把下面的视频文案优化成可以直接交给 AI 视频模型执行的拍摄脚本。

原始文案：
${script.trim()}

${extraRequirements.trim() ? `额外要求：\n${extraRequirements.trim()}\n` : ""}
要求：
1. 保留原意、角色数量、产品事实和必须出现的物品，不虚构品牌、功能或承诺。
2. 按时间顺序写清角色动作、表情、场景变化、镜头运动、构图和光线。
3. 开头与结尾必须是清楚、稳定、可单独生成的画面。
4. 用连续自然语言输出可直接用于视频生成的完整中文文案，不要解释优化过程，不要使用 Markdown 标题。`;
}

export function buildCharacterNineViewPrompt(payload: VideoStudioWorkflowRunPayload, characterIndex: number) {
    return `你正在制作视频角色一致性锚点。参考图中角色是“角色 ${characterIndex + 1}”的唯一身份事实来源。

请生成一张完整的 3x3 九视图角色设定表，每个格子只能展示同一个角色，并严格按以下顺序排列：
第一行：正面全身、背面全身、左侧全身。
第二行：右侧全身、俯视全身、低机位仰视全身。
第三行：五官近景、四肢与手脚细节、服装与配饰细节。

必须锁定脸型、五官比例、发际线、发型、年龄感、肤色、身高、体型、身体比例、标志性特征、服装结构、颜色、材质和配饰。九格使用一致的中性浅灰背景、柔和均匀光线与真实比例；全身视图采用自然 A-pose，面部清晰，手脚完整。不得换人、增减年龄、改变体型或服装，不得出现额外肢体、镜像五官、裁断身体、其他人物、水印或无关文字。输出一张九宫格成图，不要输出说明或提示词。

视频文案仅用于理解角色后续动作与气质，不得据此修改角色身份：${payload.script.trim()}`;
}

export function buildVideoFramePrompt(payload: VideoStudioWorkflowRunPayload, frame: "opening" | "ending") {
    const isOpening = frame === "opening";
    const optionalRequirements = [
        payload.objectFiles.length ? `制作参考总览中的 ${payload.objectFiles.length} 件物品必须在画面中清晰、合理地出现。` : "",
        payload.sceneFiles.length ? `必须采用制作参考总览中的场景，不得替换成相似场景。` : "",
        payload.extraRequirements.trim(),
    ]
        .filter(Boolean)
        .join("\n");
    return `参考图 1 是本片的“制作参考总览”，包含全部角色身份锚点${payload.objectFiles.length ? "、指定物品" : ""}${payload.sceneFiles.length ? "和指定场景" : ""}。${isOpening ? "" : "参考图 2 是已经生成的视频头帧，尾帧必须与它保持镜头轴线和视觉连续性。"}

请生成视频${isOpening ? "头帧" : "尾帧"}，只输出一张完整画面，不要九宫格或分镜拼图。
${isOpening ? "画面对应文案开始前或第一个动作刚要发生的瞬间，要清楚建立人物、场景和动作起点，并给后续运动留出空间。" : "画面对应文案最后一个动作完成后的稳定瞬间，要形成明确收束，并与头帧保持人物身份、服装、物品、场景、光线方向和镜头轴线连续。"}

角色数量固定为 ${payload.characterFiles.length}，每个角色都必须与制作参考总览一致，不得换脸、合并角色、增加路人或改变服装。${optionalRequirements ? `\n${optionalRequirements}` : ""}

视频文案：
${payload.script.trim()}

使用电影级但可执行的构图和真实光线，面部与手部清晰，画面适配 ${videoWorkflowAspectLabel(payload.videoSize)}。不得添加字幕、标识、水印或说明文字，除非文案明确要求。`;
}

export function buildFinalVideoPrompt(payload: VideoStudioWorkflowRunPayload, includeReferenceBoard: boolean) {
    const mandatory = [
        payload.objectFiles.length ? `制作参考总览中的 ${payload.objectFiles.length} 件物品必须在成片中真实、清晰地出现。` : "",
        payload.sceneFiles.length ? "场景必须以制作参考总览为准，不得替换。" : "",
        payload.extraRequirements.trim(),
    ]
        .filter(Boolean)
        .join("\n");
    const references = includeReferenceBoard
        ? "请根据三张参考图生成一条连续视频：参考图 1 是制作参考总览，参考图 2 是视频头帧，参考图 3 是视频尾帧。第一帧必须与参考图 2 对齐，最后一帧必须自然收束到参考图 3；始终使用参考图 1 锁定角色、物品和场景。"
        : "请根据两张关键帧生成一条连续视频：参考图 1 是视频头帧，参考图 2 是视频尾帧。第一帧必须与参考图 1 对齐，最后一帧必须自然收束到参考图 2；两张关键帧已经依据全部角色九视图、指定物品和指定场景生成。";
    return `${references}

中间过程根据文案补全动作、场景变化和镜头运动。始终锁定 ${payload.characterFiles.length} 个角色的脸型、五官、发型、年龄感、体型、身体比例、服装、颜色、材质和配饰，不得换脸、串角色、合并角色、增加人物或出现肢体畸变。

视频文案：
${payload.script.trim()}

${mandatory ? `硬性要求：\n${mandatory}\n` : ""}目标时长 ${payload.videoSeconds} 秒，画面规格 ${videoWorkflowAspectLabel(payload.videoSize)}，动作必须符合真实物理与人物关节逻辑，镜头连续、速度自然、主体清楚。不要生成字幕、水印、分屏、九宫格或幕后说明。`;
}

export function videoWorkflowFrameSize(videoSize: string) {
    if (!videoSize || videoSize === "auto" || videoSize === "adaptive") return "16:9";
    return videoSize;
}

export type WorkflowReferenceBoardItem = {
    label: string;
    dataUrl: string;
};

export async function createWorkflowReferenceBoard(items: WorkflowReferenceBoardItem[]) {
    if (!items.length) throw new Error("制作参考总览没有可用图片");
    const images = await Promise.all(items.map(async (item) => ({ ...item, image: await loadImage(item.dataUrl) })));
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(images.length))));
    const rows = Math.ceil(images.length / columns);
    const padding = 28;
    const gap = 18;
    const tileWidth = 500;
    const tileHeight = 360;
    const labelHeight = 42;
    const canvas = document.createElement("canvas");
    canvas.width = padding * 2 + columns * tileWidth + (columns - 1) * gap;
    canvas.height = padding * 2 + rows * (tileHeight + labelHeight) + (rows - 1) * gap;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("浏览器无法创建制作参考总览");

    ctx.fillStyle = "#e7e5e4";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach(({ image, label }, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = padding + column * (tileWidth + gap);
        const y = padding + row * (tileHeight + labelHeight + gap);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, tileWidth, tileHeight + labelHeight);
        const scale = Math.min(tileWidth / image.width, tileHeight / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.drawImage(image, x + (tileWidth - width) / 2, y + (tileHeight - height) / 2, width, height);
        ctx.fillStyle = "#1c1917";
        ctx.font = "600 20px sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x + 14, y + tileHeight + labelHeight / 2, tileWidth - 28);
    });

    return canvasToBlob(canvas);
}

function videoWorkflowAspectLabel(value: string) {
    if (!value || value === "auto" || value === "adaptive") return "自适应画幅";
    if (value === "1280x720" || value === "16:9") return "16:9 横屏";
    if (value === "720x1280" || value === "9:16") return "9:16 竖屏";
    if (value === "1024x1024" || value === "1:1") return "1:1 方形";
    return value;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("制作参考总览导出失败"))), "image/jpeg", 0.92);
    });
}

type Rgb = { r: number; g: number; b: number };
type PantoneColor = Rgb & { code: string };

const PANTONE_REFERENCE_COLORS: PantoneColor[] = [
    { code: "11-0601 TCX", r: 244, g: 245, b: 240 },
    { code: "19-0303 TCX", r: 43, g: 43, b: 41 },
    { code: "18-1664 TCX", r: 190, g: 58, b: 52 },
    { code: "17-1564 TCX", r: 247, g: 83, b: 78 },
    { code: "16-1546 TCX", r: 250, g: 114, b: 104 },
    { code: "15-1247 TCX", r: 255, g: 160, b: 93 },
    { code: "13-0858 TCX", r: 255, g: 220, b: 77 },
    { code: "15-0343 TCX", r: 166, g: 186, b: 68 },
    { code: "17-5641 TCX", r: 0, g: 152, b: 116 },
    { code: "18-5338 TCX", r: 0, g: 121, b: 107 },
    { code: "16-4725 TCX", r: 66, g: 176, b: 194 },
    { code: "18-4043 TCX", r: 0, g: 114, b: 206 },
    { code: "19-4052 TCX", r: 15, g: 76, b: 129 },
    { code: "18-3838 TCX", r: 102, g: 78, b: 167 },
    { code: "17-2031 TCX", r: 217, g: 89, b: 139 },
    { code: "18-2143 TCX", r: 194, g: 24, b: 91 },
    { code: "17-1328 TCX", r: 169, g: 112, b: 81 },
    { code: "18-1142 TCX", r: 139, g: 69, b: 19 },
    { code: "14-1118 TCX", r: 210, g: 180, b: 140 },
    { code: "14-4202 TCX", r: 183, g: 188, b: 192 },
];

export async function addPantoneReferenceCard(imageUrl: string) {
    try {
        const image = await loadImage(imageUrl);
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx || !canvas.width || !canvas.height) return imageUrl;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const colors = extractDominantColors(ctx, canvas.width, canvas.height).map((rgb) => ({ rgb, pantone: nearestPantone(rgb) }));
        drawPantoneCard(ctx, canvas.width, canvas.height, colors);
        return canvas.toDataURL("image/png");
    } catch {
        return imageUrl;
    }
}

async function loadImage(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Unable to load generated image");
    const objectUrl = URL.createObjectURL(await response.blob());
    try {
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("Unable to decode generated image"));
            image.src = objectUrl;
        });
        return image;
    } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
}

function extractDominantColors(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const sample = document.createElement("canvas");
    sample.width = 72;
    sample.height = 72;
    const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
    if (!sampleCtx) return [{ r: 128, g: 128, b: 128 }];
    sampleCtx.drawImage(ctx.canvas, 0, 0, width, height, 0, 0, sample.width, sample.height);
    const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 220) continue;
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max > 244 && min > 238) continue;
        const key = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(b / 24)}`;
        const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
    }
    const candidates = Array.from(buckets.values())
        .sort((a, b) => b.count - a.count)
        .map((item) => ({ r: Math.round(item.r / item.count), g: Math.round(item.g / item.count), b: Math.round(item.b / item.count) }));
    const selected: Rgb[] = [];
    for (const color of candidates) {
        if (selected.every((existing) => colorDistance(existing, color) > 52)) selected.push(color);
        if (selected.length === 4) break;
    }
    return selected.length ? selected : [{ r: 128, g: 128, b: 128 }];
}

function nearestPantone(color: Rgb) {
    return PANTONE_REFERENCE_COLORS.reduce((best, item) => (colorDistance(color, item) < colorDistance(color, best) ? item : best));
}

function colorDistance(a: Rgb, b: Rgb) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function drawPantoneCard(ctx: CanvasRenderingContext2D, width: number, height: number, colors: Array<{ rgb: Rgb; pantone: PantoneColor }>) {
    const scale = Math.max(0.7, Math.min(1.8, width / 1600));
    const margin = Math.round(28 * scale);
    const panelWidth = Math.min(Math.round(width * 0.29), Math.round(430 * scale));
    const headerHeight = Math.round(54 * scale);
    const rowHeight = Math.round(74 * scale);
    const panelHeight = headerHeight + colors.length * rowHeight + Math.round(18 * scale);
    const x = width - panelWidth - margin;
    const y = margin;
    roundedRect(ctx, x, y, panelWidth, panelHeight, Math.round(8 * scale));
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(28,25,23,0.18)";
    ctx.lineWidth = Math.max(1, Math.round(scale));
    ctx.stroke();
    ctx.fillStyle = "#1c1917";
    ctx.font = `600 ${Math.round(18 * scale)}px sans-serif`;
    ctx.fillText("PANTONE Ref.", x + Math.round(18 * scale), y + Math.round(33 * scale));
    colors.forEach(({ rgb, pantone }, index) => {
        const rowY = y + headerHeight + index * rowHeight;
        const swatch = Math.round(46 * scale);
        ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
        ctx.fillRect(x + Math.round(18 * scale), rowY + Math.round(8 * scale), swatch, swatch);
        ctx.strokeStyle = "rgba(28,25,23,0.16)";
        ctx.strokeRect(x + Math.round(18 * scale), rowY + Math.round(8 * scale), swatch, swatch);
        ctx.fillStyle = "#292524";
        ctx.font = `600 ${Math.round(14 * scale)}px sans-serif`;
        ctx.fillText(pantone.code, x + Math.round(78 * scale), rowY + Math.round(29 * scale));
        ctx.fillStyle = "#78716c";
        ctx.font = `400 ${Math.round(11 * scale)}px sans-serif`;
        ctx.fillText(`#${hex(rgb.r)}${hex(rgb.g)}${hex(rgb.b)}`, x + Math.round(78 * scale), rowY + Math.round(48 * scale));
    });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function hex(value: number) {
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0").toUpperCase();
}
