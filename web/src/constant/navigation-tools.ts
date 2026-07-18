import { FileText, ImagePlus, Images, Maximize2, Video } from "lucide-react";

import type { StudioLocale } from "@/stores/use-studio-locale-store";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "image",
        icon: ImagePlus,
    },
    {
        slug: "video",
        icon: Video,
    },
    {
        slug: "prompts",
        icon: FileText,
    },
    {
        slug: "assets",
        icon: Images,
    },
] as const;

const NAVIGATION_LABELS: Record<StudioLocale, Record<NavigationToolSlug, string>> = {
    zh: {
        canvas: "我的画布",
        image: "生图工作台",
        video: "视频创作台",
        prompts: "提示词库",
        assets: "我的素材",
    },
    en: {
        canvas: "Canvas",
        image: "Image Studio",
        video: "Video Studio",
        prompts: "Prompt Library",
        assets: "Assets",
    },
};

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

export function navigationToolLabel(slug: NavigationToolSlug, locale: StudioLocale) {
    return NAVIGATION_LABELS[locale][slug] || slug;
}
