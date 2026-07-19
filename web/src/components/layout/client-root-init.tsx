import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { catalogToConfigPatch, fetchStudioCatalog, isStudioManagedHost, studioSelf } from "@/services/studio-managed";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";

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

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        if (isStudioManagedHost()) {
            handledConfigParams.current = true;
            return;
        }
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
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
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
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
                const patch = catalogToConfigPatch(useConfigStore.getState().config, models);
                for (const [key, value] of Object.entries(patch)) {
                    updateConfig(key as keyof typeof patch as never, value as never);
                }
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
    }, [message, setBootstrapped, setStudioUser, updateConfig]);

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
                .catch(() => undefined)
                .finally(() => {
                    refreshPromise = null;
                });
            return refreshPromise;
        };
        const onVisibility = () => {
            if (document.visibilityState === "visible") void syncSession();
        };
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") void syncSession();
        }, 30000);
        window.addEventListener("focus", syncSession);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.removeEventListener("focus", syncSession);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [bootstrapped, setStudioUser, studioUser?.id, studioUser?.source]);

    return <>{children}</>;
}
