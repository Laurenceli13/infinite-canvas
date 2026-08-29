"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { App } from "antd";

import { fetchUserConfig } from "@/services/api/user-config";
import { defaultUserStorageProvider, defaultUserWebDAVStorageProvider, saveUserStorageProvider, saveUserWebDAVStorageProvider } from "@/services/image-storage";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { catalogToConfigPatch, fetchStudioCatalog, isStudioManagedHost, studioSelf } from "@/services/studio-managed";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const pathname = usePathname();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const setSession = useUserStore((state) => state.setSession);
    const clearSession = useUserStore((state) => state.clearSession);
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const channelMode = useConfigStore((state) => state.config.channelMode);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";
    const adminRemoteTokenRef = useRef("");
    const studioIdentity = `${user?.id || ""}:${user?.role || ""}`;
    const studioCatalogRequestRef = useRef(0);

    useEffect(() => {
        if (!isStudioManagedHost()) return;
        const migrationKey = "studio-managed:stream-default-v1";
        if (window.localStorage.getItem(migrationKey) === "1") return;
        const current = useConfigStore.getState().config;
        if (current.streamImages !== "1") updateConfig("streamImages", "1");
        if (current.streamPartialImages !== "1") updateConfig("streamPartialImages", "1");
        window.localStorage.setItem(migrationKey, "1");
    }, [updateConfig]);

    useEffect(() => {
        if (!isStudioManagedHost()) return;
        const requestId = ++studioCatalogRequestRef.current;
        const bootstrap = async () => {
            try {
                // Load the session first so a login that happens after the
                // initial shell mount gets a fresh, role-aware catalog too.
                const studioUser = await studioSelf();
                if (requestId !== studioCatalogRequestRef.current) return;
                useStudioSessionStore.getState().setUser(studioUser);
                useStudioSessionStore.getState().setReady(true);
                setSession("studio-session", {
                    id: studioUser.id,
                    username: studioUser.username,
                    displayName: studioUser.username,
                    avatarUrl: "",
                    role: studioUser.role === "studio_admin" ? "admin" : "user",
                    credits: Number(studioUser.points || 0),
                    createdAt: "",
                    updatedAt: "",
                });
                try {
                    const models = await fetchStudioCatalog();
                    if (requestId !== studioCatalogRequestRef.current) return;
                    const patch = catalogToConfigPatch(useConfigStore.getState().config, models);
                    Object.entries(patch).forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
                } catch {
                    // Keep the authenticated session and any last-known model
                    // list when the catalog request is temporarily unavailable.
                }
            } catch {
                if (requestId === studioCatalogRequestRef.current) {
                    useStudioSessionStore.getState().setReady(true);
                    clearSession();
                }
            }
        };
        void bootstrap();
    }, [clearSession, setSession, studioIdentity, updateConfig]);

    useEffect(() => {
        if (isStudioManagedHost()) return;
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        if (isStudioManagedHost()) return;
        if (!isLoginPage) void hydrateUser();
    }, [hydrateUser, isLoginPage]);

    useEffect(() => {
        if (isStudioManagedHost()) return;
        if (!token || user?.role !== "admin" || adminRemoteTokenRef.current === token) return;
        adminRemoteTokenRef.current = token;
        if (channelMode !== "remote") updateConfig("channelMode", "remote");
    }, [channelMode, token, updateConfig, user?.role]);

    useEffect(() => {
        if (isStudioManagedHost()) return;
        if (!token || !user?.id) return;
        void fetchUserConfig(token)
            .then((payload) => {
                const syncS3 = payload.modelConfig?.syncStorageConfig === true;
                const syncWebDAV = payload.modelConfig?.syncWebDAVStorageConfig === true;
                if (payload.modelConfig) {
                    Object.entries(payload.modelConfig)
                        .forEach(([key, value]) => updateConfig(key as keyof AiConfig, value as never));
                }
                updateConfig("syncStorageConfig", syncS3);
                updateConfig("syncWebDAVStorageConfig", syncWebDAV);
                if (syncS3 && payload.storageProvider?.s3) {
                    saveUserStorageProvider({
                        ...defaultUserStorageProvider(),
                        ...payload.storageProvider.s3,
                        type: "s3",
                    });
                }
                if (syncWebDAV && payload.storageProvider?.webdav) {
                    saveUserWebDAVStorageProvider({
                        ...defaultUserWebDAVStorageProvider(),
                        ...payload.storageProvider.webdav,
                        type: "webdav",
                    });
                }
            })
            .catch(() => {});
    }, [token, updateConfig, user?.id]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        if (!publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (!publicSettings.modelChannel.allowCustomChannel) {
            openConfigDialog(false);
            message.error("后台未允许用户自定义渠道，请联系管理员进行配置");
            return;
        }
        updateConfig("channelMode", "local");
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
    }, [message, openConfigDialog, publicSettings, updateConfig]);

    return <>{children}</>;
}
