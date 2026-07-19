import { Drawer } from "antd";
import { Link } from "react-router-dom";

import { navigationToolLabel, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";
import { isStudioManagedHost } from "@/services/studio-managed";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const locale = useStudioLocaleStore((state) => state.locale);

    return (
        <Drawer title={locale === "zh" ? "导航" : "Navigation"} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {navigationTools.filter((tool) => !isStudioManagedHost() || tool.slug !== "config").map((tool) => {
                    const Icon = tool.icon;
                    const active = tool.slug === activeToolSlug;
                    return (
                        <Link
                            key={tool.slug}
                            to={`/${tool.slug}`}
                            onClick={onClose}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{navigationToolLabel(tool.slug, locale)}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
