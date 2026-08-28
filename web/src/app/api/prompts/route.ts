import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    createdAt: string;
    updatedAt: string;
};

type PromptSource = {
    id: string;
    name: string;
    url: string;
    homepage: string;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6_000;
const sources: PromptSource[] = [
    { id: "banana-prompt-quicker", name: "Banana Prompt Quicker", url: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/banana-prompt-quicker.json", homepage: "https://glidea.github.io/banana-prompt-quicker/" },
    {
        id: "davidwu-gpt-image2-prompts",
        name: "DavidWu GPT Image 2",
        url: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/davidwu-gpt-image2-prompts.json",
        homepage: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts",
    },
    { id: "freestylefly-gpt-image-2", name: "Freestylefly GPT Image 2", url: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/freestylefly-gpt-image-2.json", homepage: "https://github.com/freestylefly/awesome-gpt-image-2" },
    { id: "awesome-gpt-image", name: "Awesome GPT Image", url: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/awesome-gpt-image.json", homepage: "https://github.com/ZeroLu/awesome-gpt-image" },
    { id: "awesome-gpt4o-image-prompts", name: "Awesome GPT-4o", url: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/awesome-gpt4o-image-prompts.json", homepage: "https://github.com/ImgEdify/Awesome-GPT4o-image-prompts" },
    { id: "youmind-gpt-image-2", name: "YouMind GPT Image 2", url: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/youmind-gpt-image-2.json", homepage: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2" },
    {
        id: "youmind-nano-banana-pro",
        name: "YouMind Nano Banana Pro",
        url: "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources/youmind-nano-banana-pro.json",
        homepage: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts",
    },
];

const fallbackPrompts: Prompt[] = [
    {
        id: "fallback-product-poster",
        title: "高端产品海报",
        coverUrl: "",
        prompt: "为产品制作一张高端商业海报，主体清晰，材质细节丰富，留出简洁的标题区域，摄影棚光线，干净背景，适合电商首图。",
        tags: ["电商", "海报"],
        category: "内置提示词",
        githubUrl: "",
        preview: "",
        createdAt: "",
        updatedAt: "",
    },
    {
        id: "fallback-editorial-portrait",
        title: "杂志人像",
        coverUrl: "",
        prompt: "创作一张杂志封面风格的人像照片，人物神态自然，构图克制，柔和侧光，细腻肤质，高级中性色彩，画面具有 editorial photography 质感。",
        tags: ["人像", "摄影"],
        category: "内置提示词",
        githubUrl: "",
        preview: "",
        createdAt: "",
        updatedAt: "",
    },
    {
        id: "fallback-cinematic-scene",
        title: "电影感场景",
        coverUrl: "",
        prompt: "将场景表现为电影剧照，明确前景、中景和背景层次，使用体积光和自然环境色，主体有清晰动作与情绪，宽银幕构图，细节真实。",
        tags: ["电影感", "场景"],
        category: "内置提示词",
        githubUrl: "",
        preview: "",
        createdAt: "",
        updatedAt: "",
    },
];

let cachedCatalog: { items: Prompt[]; fetchedAt: number } | null = null;
let catalogPromise: Promise<Prompt[]> | null = null;

export async function GET(request: NextRequest) {
    const query = request.nextUrl.searchParams;
    const keyword = (query.get("keyword") || "").trim().toLowerCase();
    const category = (query.get("category") || "").trim();
    const tags = query
        .getAll("tag")
        .map((tag) => tag.trim())
        .filter(Boolean);
    const page = positiveInteger(query.get("page"), 1);
    const pageSize = Math.min(500, positiveInteger(query.get("pageSize"), 20));

    try {
        const catalog = await getCatalog();
        const filtered = catalog.filter((item) => {
            if (category && item.category !== category) return false;
            if (tags.length && !tags.every((tag) => item.tags.includes(tag))) return false;
            if (keyword && ![item.title, item.prompt, item.category, ...item.tags].join(" ").toLowerCase().includes(keyword)) return false;
            return true;
        });
        const start = (page - 1) * pageSize;
        return Response.json({
            code: 0,
            data: {
                items: filtered.slice(start, start + pageSize).map(toPublicPrompt),
                tags: [...new Set(catalog.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)),
                categories: [...new Set(catalog.map((item) => item.category))],
                total: filtered.length,
            },
            msg: "",
        });
    } catch (error) {
        return Response.json({ code: 1, data: null, msg: error instanceof Error ? error.message : "获取提示词失败，请稍后重试" }, { status: 503 });
    }
}

async function getCatalog() {
    if (cachedCatalog && Date.now() - cachedCatalog.fetchedAt < CACHE_TTL_MS) return cachedCatalog.items;
    // Do not make users wait for a remote refresh after the first catalog exists.
    if (cachedCatalog) {
        if (!catalogPromise) {
            catalogPromise = loadCatalog()
                .then((items) => {
                    cachedCatalog = { items, fetchedAt: Date.now() };
                    return items;
                })
                .finally(() => {
                    catalogPromise = null;
                });
        }
        return cachedCatalog.items;
    }
    if (!catalogPromise) catalogPromise = loadCatalog();
    try {
        const items = await catalogPromise;
        cachedCatalog = { items, fetchedAt: Date.now() };
        return items;
    } finally {
        catalogPromise = null;
    }
}

async function loadCatalog() {
    const results = await Promise.allSettled(sources.map(loadSource));
    const items = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (items.length) return dedupe(items);
    if (cachedCatalog?.items.length) return cachedCatalog.items;
    return fallbackPrompts;
}

async function loadSource(source: PromptSource): Promise<Prompt[]> {
    const candidates = [jsDelivrUrl(source.url), source.url, "https://r.jina.ai/http://" + source.url.replace(/^https?:\/\//, "")].filter((url, index, all) => url && all.indexOf(url) === index);
    let lastError = "提示词源暂时不可用";
    for (const url of candidates) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(url, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json", "User-Agent": "InfiniteCanvasPromptProxy/1.0" } });
            if (!response.ok) {
                lastError = "HTTP " + response.status;
                continue;
            }
            const data = JSON.parse(await response.text()) as unknown;
            return normalizeItems(data, source);
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(source.name + ": " + lastError);
}

function toPublicPrompt(item: Prompt): Prompt {
    if (!item.coverUrl || item.coverUrl.startsWith("/api/prompt-image")) return item;
    return { ...item, coverUrl: "/api/prompt-image?url=" + encodeURIComponent(item.coverUrl) };
}

function normalizeItems(data: unknown, source: PromptSource) {
    const record = data && typeof data === "object" ? (data as { items?: unknown[] }) : {};
    const values = Array.isArray(data) ? data : Array.isArray(record.items) ? record.items : [];
    const seen = new Set<string>();
    const items: Prompt[] = [];
    values.forEach((value, index) => {
        const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const title = stringValue(item.title || item.name).trim();
        const prompt = stringValue(item.prompt || item.content || item.text).trim();
        if (!title || !prompt) return;
        const id = stringValue(item.id).trim() || source.id + "-" + String(index + 1).padStart(4, "0");
        if (seen.has(id)) return;
        seen.add(id);
        const references = stringArray(item.referenceImageUrls || item.reference_image_urls).map((url) => absoluteUrl(source.url, url));
        const coverUrl = absoluteUrl(source.url, stringValue(item.coverUrl || item.cover_url)) || references[0] || "";
        items.push({
            id,
            title,
            prompt,
            coverUrl,
            tags: stringArray(item.tags),
            category: source.name,
            githubUrl: source.homepage,
            preview: stringValue(item.preview),
            createdAt: stringValue(item.createdAt || item.created_at),
            updatedAt: stringValue(item.updatedAt || item.updated_at),
        });
    });
    return items;
}

function dedupe(items: Prompt[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = item.title.toLowerCase() + "::" + item.prompt;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function positiveInteger(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value)
        ? value
              .map(stringValue)
              .map((item) => item.trim())
              .filter(Boolean)
        : [];
}

function absoluteUrl(baseUrl: string, value: string) {
    if (!value) return "";
    try {
        return new URL(value, baseUrl).toString();
    } catch {
        return value;
    }
}

function jsDelivrUrl(rawUrl: string) {
    const match = rawUrl.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    return match ? `https://cdn.jsdelivr.net/gh/${match[1]}/${match[2]}@${match[3]}/${match[4]}` : rawUrl;
}
