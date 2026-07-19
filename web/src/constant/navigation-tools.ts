import { FileText, ImagePlus, Images, Maximize2, Settings2, Video } from "lucide-react";
import type { StudioLocale } from "@/stores/use-studio-locale-store";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
    },
    {
        slug: "assets",
        label: "我的资产",
        icon: Images,
    },
    {
        slug: "config",
        label: "配置",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

const NAVIGATION_LABELS: Record<StudioLocale, Record<NavigationToolSlug, string>> = {
    zh: {
        canvas: "我的画布",
        image: "生图工作台",
        video: "视频创作台",
        prompts: "提示词库",
        assets: "我的素材",
        config: "配置",
    },
    en: {
        canvas: "Canvas",
        image: "Image Studio",
        video: "Video Studio",
        prompts: "Prompt Library",
        assets: "Assets",
        config: "Settings",
    },
};

export function navigationToolLabel(slug: NavigationToolSlug, locale: StudioLocale) {
    return NAVIGATION_LABELS[locale][slug] || slug;
}
