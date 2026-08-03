import { Bot, Globe, Menu } from "lucide-react";
import { Button, Segmented, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";

import { navigationToolLabel, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/use-agent-store";
import { isStudioManagedHost } from "@/services/studio-managed";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";

export function AppTopNav() {
    const { pathname } = useLocation();
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const locale = useStudioLocaleStore((state) => state.locale);
    const setLocale = useStudioLocaleStore((state) => state.setLocale);
    const managed = isStudioManagedHost();
    const visibleTools = managed ? navigationTools.filter((tool) => tool.slug !== "config") : navigationTools;
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = visibleTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            {!hideHeader ? (
                <header className="sticky top-0 z-20 h-14 shrink-0 border-b border-stone-200 bg-background/90 backdrop-blur-xl dark:border-stone-800">
                    <div className="mx-auto flex h-full max-w-7xl items-stretch justify-between gap-3 px-4 sm:px-6">
                        <div className="flex min-w-0 flex-1 items-center">
                            <Link to="/" className="flex h-full shrink-0 items-center gap-2 text-sm font-semibold leading-none tracking-tight text-stone-950 transition hover:text-stone-600 dark:text-stone-100 dark:hover:text-stone-300">
                                <span
                                    className="size-5 shrink-0 bg-current"
                                    style={{
                                        mask: "url(/logo.svg) center / contain no-repeat",
                                        WebkitMask: "url(/logo.svg) center / contain no-repeat",
                                    }}
                                />
                                <span className="hidden text-base font-medium sm:inline">无限画布</span>
                            </Link>

                            <button
                                type="button"
                                className="ml-3 inline-flex size-8 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 md:hidden dark:text-stone-300 dark:hover:text-white"
                                onClick={() => setMobileNavOpen(true)}
                                aria-label="打开导航菜单"
                                title="导航菜单"
                            >
                                <Menu className="size-5" />
                            </button>

                            <nav className="hide-scrollbar ml-4 hidden h-14 min-w-0 flex-1 items-center gap-4 overflow-x-auto md:flex">
                                {visibleTools.map((tool) => {
                                    const Icon = tool.icon;
                                    const label = navigationToolLabel(tool.slug, locale);
                                    const active = tool.slug === activeToolSlug;
                                    return (
                                        <Link
                                            key={tool.slug}
                                            to={`/${tool.slug}`}
                                            aria-label={label}
                                            title={label}
                                            className={cn(
                                                "relative flex h-14 shrink-0 items-center gap-2 text-sm leading-6 transition after:absolute after:inset-x-0 after:bottom-0 after:h-px",
                                                active
                                                    ? "font-medium text-stone-950 after:bg-stone-950 dark:text-stone-100 dark:after:bg-stone-100"
                                                    : "text-stone-500 after:bg-transparent hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100",
                                            )}
                                        >
                                            <Icon className="size-4" />
                                            <span className="hidden truncate xl:inline">{label}</span>
                                        </Link>
                                    );
                                })}
                            </nav>
                        </div>

                        <div className="my-auto flex h-9 shrink-0 min-w-0 items-center justify-end gap-1 md:gap-2 whitespace-nowrap">
                            <div className="hidden items-center gap-2 xl:flex">
                                <Globe className="size-4 text-stone-500" />
                                <Segmented
                                    size="small"
                                    value={locale}
                                    onChange={(value) => setLocale(value as "zh" | "en")}
                                    options={[{ label: "中文", value: "zh" }, { label: "EN", value: "en" }]}
                                />
                            </div>
                            <Button type="text" className="inline-flex xl:hidden" icon={<Globe className="size-4" />} onClick={() => setLocale(locale === "zh" ? "en" : "zh")} aria-label={locale === "zh" ? "切换到英文" : "Switch to Chinese"} />
                            <Tooltip title={panelOpen ? "收起 Agent" : "打开 Agent"}>
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label="打开 Agent" />
                            </Tooltip>
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
