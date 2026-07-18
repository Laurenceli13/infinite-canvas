import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useNavigate } from "react-router-dom";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { navigationTools, navigationToolLabel } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

export default function HomePage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const locale = useStudioLocaleStore((state) => state.locale);
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    const copy =
        locale === "zh"
            ? {
                  title: "无限画布",
                  introA: "在",
                  introB: "无限画布",
                  introC: "中生成、连接和重组",
                  introD: "图片、文字与图形",
                  introE: "，让创作从单次生成变成连续推演。",
                  start: "开始使用",
                  openCanvas: "打开画布",
                  showcaseTitle: "沉淀每一次好结果",
                  showcaseSubtitle: "收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。",
                  promptLibrary: "查看提示词库",
                  loadError: "获取提示词失败",
              }
            : {
                  title: "Infinite Canvas",
                  introA: "Generate, connect, and reshape",
                  introB: "visual ideas",
                  introC: "across the",
                  introD: "infinite canvas",
                  introE: "so creation becomes an evolving workflow instead of a single prompt.",
                  start: "Get Started",
                  openCanvas: "Open Canvas",
                  showcaseTitle: "Keep Every Strong Result",
                  showcaseSubtitle: "Save proven prompts, visual references, and results so the next round starts with momentum.",
                  promptLibrary: "Open Prompt Library",
                  loadError: "Failed to load prompts",
              };

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : copy.loadError));
    }, [copy.loadError, message]);

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.18)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden px-6">
                <div className="pointer-events-none absolute left-[15%] top-24 size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />
                <div className="pointer-events-none absolute right-[23%] top-[48%] size-20 rounded-full border border-dashed border-stone-200 dark:border-stone-800" />

                <div className="relative flex min-h-[620px] flex-col items-center justify-center pt-10 text-center">
                    <h1 className="ai-title-aurora max-w-5xl text-balance text-5xl font-semibold tracking-normal sm:text-7xl lg:text-8xl">{copy.title}</h1>
                    <p className="mt-8 max-w-3xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-400">
                        {locale === "zh" ? (
                            <>
                                {copy.introA}
                                <Highlighter action="underline" color="#FF9800">
                                    {copy.introB}
                                </Highlighter>
                                {copy.introC}
                                <Highlighter action="highlight" color="#87CEFA">
                                    {copy.introD}
                                </Highlighter>
                                {copy.introE}
                            </>
                        ) : (
                            <>
                                {copy.introA}
                                <Highlighter action="highlight" color="#87CEFA">
                                    {" "}
                                    {copy.introB}{" "}
                                </Highlighter>
                                {copy.introC}
                                <Highlighter action="underline" color="#FF9800">
                                    {" "}
                                    {copy.introD}{" "}
                                </Highlighter>
                                {copy.introE}
                            </>
                        )}
                    </p>
                    <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                        <Button type="primary" size="large" onClick={() => navigate(`/${primaryTool.slug}`)} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {copy.start}
                        </Button>
                        <Button size="large" onClick={() => navigate("/canvas")}>
                            {copy.openCanvas}
                        </Button>
                    </div>
                </div>

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-stone-200 pt-12 dark:border-stone-800">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">{copy.showcaseTitle}</h2>
                            <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">{copy.showcaseSubtitle}</p>
                        </div>
                        <Button type="link" onClick={() => navigate("/prompts")} className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {copy.promptLibrary}
                        </Button>
                    </div>
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden border border-stone-200 bg-stone-100 text-left dark:border-stone-800 dark:bg-stone-900",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="mt-8 flex justify-center text-sm text-stone-500 dark:text-stone-400">
                        {locale === "zh" ? `当前主入口：${navigationToolLabel(primaryTool.slug, locale)}` : `Primary workspace: ${navigationToolLabel(primaryTool.slug, locale)}`}
                    </div>
                </section>
            </section>
            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
