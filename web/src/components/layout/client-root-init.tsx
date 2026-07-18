import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { catalogToConfigPatch, fetchStudioCatalog, isStudioManagedHost, studioSelf } from "@/services/studio-managed";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";
import { createModelChannel, normalizeControlledBaseUrl, useConfigStore } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const handledStudioBootstrap = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const studioUser = useStudioSessionStore((state) => state.user);
    const bootstrapped = useStudioSessionStore((state) => state.bootstrapped);
    const setStudioUser = useStudioSessionStore((state) => state.setUser);
    const setBootstrapped = useStudioSessionStore((state) => state.setBootstrapped);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const controlledBaseUrl = baseUrl ? normalizeControlledBaseUrl(baseUrl) : "";
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(controlledBaseUrl ? { baseUrl: controlledBaseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: controlledBaseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (controlledBaseUrl) updateConfig("baseUrl", controlledBaseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    useEffect(() => {
        if (handledStudioBootstrap.current) return;
        handledStudioBootstrap.current = true;
        if (!isStudioManagedHost()) {
            setBootstrapped(true);
            return;
        }
        let cancelled = false;
        const loadCatalog = async () => {
            try {
                const models = await fetchStudioCatalog();
                if (cancelled) return;
                const patch = catalogToConfigPatch(config, models);
                (Object.keys(patch) as Array<keyof typeof patch>).forEach((key) => {
                    updateConfig(key as never, patch[key] as never);
                });
            } catch {
                if (!cancelled) message.warning("模型目录加载较慢，请稍后刷新或联系管理员检查 Studio 后端。");
            }
        };
        void studioSelf()
            .then((user) => {
                if (cancelled) return;
                setStudioUser(user);
                setBootstrapped(true);
                void loadCatalog();
            })
            .catch(() => {
                if (!cancelled) {
                    setStudioUser(null);
                    setBootstrapped(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [config, message, setBootstrapped, setStudioUser, updateConfig]);

    useEffect(() => {
        if (!isStudioManagedHost() || !bootstrapped || !studioUser) return;
        let cancelled = false;
        let refreshPromise: Promise<void> | null = null;
        const syncSession = async () => {
            if (refreshPromise) return refreshPromise;
            refreshPromise = studioSelf()
                .then((user) => {
                    if (!cancelled) setStudioUser(user);
                })
                .catch(() => {
                    // Keep the existing UI state if a background refresh is temporarily unavailable.
                })
                .finally(() => {
                    refreshPromise = null;
                });
            return refreshPromise;
        };
        const onVisibility = () => {
            if (document.visibilityState === "visible") void syncSession();
        };
        const onFocus = () => void syncSession();
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") void syncSession();
        }, 30000);
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [bootstrapped, setStudioUser, studioUser?.id, studioUser?.source]);

    return <>{children}</>;
}
