import { Globe, Menu } from "lucide-react";
import { Button, Segmented, Tooltip } from "antd";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { navigationToolLabel, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";

export function AppTopNav() {
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const locale = useStudioLocaleStore((state) => state.locale);
    const setLocale = useStudioLocaleStore((state) => state.setLocale);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-16 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-2 px-3 lg:gap-4 lg:px-5 xl:px-6">
                        <div className="flex min-w-0 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <span
                                    className="size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="hidden text-base font-medium lg:inline">{locale === "zh" ? "无限画布" : "Infinite Canvas"}</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label={locale === "zh" ? "打开导航菜单" : "Open navigation menu"}
                                title={locale === "zh" ? "导航菜单" : "Navigation"}
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-2 hidden h-16 min-w-0 items-center gap-1 overflow-x-auto md:flex lg:ml-3 xl:ml-6 xl:gap-5">
                                {navigationTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            title={navigationToolLabel(tool.slug, locale)}
                                            aria-label={navigationToolLabel(tool.slug, locale)}
                                            className={cn(
                                                "relative flex h-16 w-8 shrink-0 items-center justify-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px xl:w-auto xl:justify-start",
                                                active
                                                    ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="hidden truncate xl:inline">{navigationToolLabel(tool.slug, locale)}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
                            <Tooltip title={locale === "zh" ? "界面语言" : "Interface language"}>
                                <div className="hidden items-center gap-2 xl:flex">
                                    <Globe className="size-4 text-stone-500" />
                                    <Segmented
                                        size="small"
                                        value={locale}
                                        onChange={(value) => setLocale(value as "zh" | "en")}
                                        options={[
                                            { label: "中文", value: "zh" },
                                            { label: "EN", value: "en" },
                                        ]}
                                    />
                                </div>
                            </Tooltip>
                            <Button
                                type="text"
                                className="inline-flex xl:hidden"
                                icon={<Globe className="size-4" />}
                                onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                                aria-label={locale === "zh" ? "切换到英文" : "Switch to Chinese"}
                            />
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />
            <AppConfigModal />
        </>
    );
}
