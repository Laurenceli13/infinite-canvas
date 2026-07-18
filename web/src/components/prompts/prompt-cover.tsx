import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";

export function PromptCover({ src, alt, className }: { src: string; alt: string; className?: string }) {
    const locale = useStudioLocaleStore((state) => state.locale);
    const [failed, setFailed] = useState(false);
    const safeSrc = src?.trim() || "";

    useEffect(() => {
        setFailed(false);
    }, [safeSrc]);

    if (!safeSrc || failed) {
        return (
            <div className={`flex items-center justify-center bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-500 ${className || ""}`.trim()}>
                <div className="flex flex-col items-center gap-2 text-center">
                    <ImageOff className="size-7" />
                    <span className="text-xs">{locale === "zh" ? "该提示词暂无封面图" : "No cover image"}</span>
                </div>
            </div>
        );
    }

    return <img src={safeSrc} alt={alt} className={className} onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
}
