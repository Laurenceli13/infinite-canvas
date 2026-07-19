import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BookOpen, History, Keyboard, LogOut, Puzzle, Settings2, Shield } from "lucide-react";
import { App, Button, Tag } from "antd";
import { Link, useNavigate } from "react-router-dom";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL } from "@/constant/env";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { isStudioManagedHost, studioLogout } from "@/services/studio-managed";
import { useConfigStore } from "@/stores/use-config-store";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const locale = useStudioLocaleStore((state) => state.locale);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const studioUser = useStudioSessionStore((state) => state.user);
    const pointsDelta = useStudioSessionStore((state) => state.pointsDelta);
    const clearPointsDelta = useStudioSessionStore((state) => state.clearPointsDelta);
    const setStudioUser = useStudioSessionStore((state) => state.setUser);
    const [displayPoints, setDisplayPoints] = useState(() => Number(studioUser?.points || 0));
    const [visibleDeltaId, setVisibleDeltaId] = useState<number | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const displayPointsRef = useRef(Number(studioUser?.points || 0));
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;

    const text = {
        zh: {
            credits: "积分",
            topUp: "充值",
            admin: "管理后台",
            usage: "使用明细",
            docs: "文档",
            settings: "配置",
            shortcuts: "快捷键",
            signOut: "退出登录",
            signedOut: "已退出登录",
            toLight: "切换到浅色主题",
            toDark: "切换到深色主题",
        },
        en: {
            credits: "credits",
            topUp: "Top up",
            admin: "Admin panel",
            usage: "Usage history",
            docs: "Docs",
            settings: "Settings",
            shortcuts: "Shortcuts",
            signOut: "Sign out",
            signedOut: "Signed out",
            toLight: "Switch to light theme",
            toDark: "Switch to dark theme",
        },
    }[locale];

    const localeCode = locale === "zh" ? "zh-CN" : "en-US";
    const formattedPoints = useMemo(
        () =>
            displayPoints.toLocaleString(localeCode, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }),
        [displayPoints, localeCode],
    );
    const formattedDelta = useMemo(() => {
        if (!pointsDelta) return "";
        const sign = pointsDelta.amount > 0 ? "+" : "";
        return `${sign}${pointsDelta.amount.toLocaleString(localeCode, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }, [localeCode, pointsDelta]);
    const pointsDeltaActive = Boolean(pointsDelta && visibleDeltaId === pointsDelta.id);
    const pointsDeltaTone = pointsDelta?.amount && pointsDelta.amount > 0 ? "gain" : "loss";

    useEffect(() => {
        const nextPoints = Number(studioUser?.points || 0);
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        const startPoints = displayPointsRef.current;
        if (Math.abs(nextPoints - startPoints) < 0.001) {
            displayPointsRef.current = nextPoints;
            setDisplayPoints(nextPoints);
            return;
        }
        const duration = 520;
        const startAt = performance.now();
        const tick = (now: number) => {
            const progress = Math.min(1, (now - startAt) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            const value = startPoints + (nextPoints - startPoints) * eased;
            displayPointsRef.current = value;
            setDisplayPoints(value);
            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(tick);
            } else {
                animationFrameRef.current = null;
                displayPointsRef.current = nextPoints;
                setDisplayPoints(nextPoints);
            }
        };
        animationFrameRef.current = requestAnimationFrame(tick);
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [studioUser?.points]);

    useEffect(() => {
        if (!pointsDelta) return;
        setVisibleDeltaId(pointsDelta.id);
        const timer = window.setTimeout(() => {
            setVisibleDeltaId((current) => (current === pointsDelta.id ? null : current));
            clearPointsDelta(pointsDelta.id);
        }, 1600);
        return () => window.clearTimeout(timer);
    }, [clearPointsDelta, pointsDelta]);

    const logout = async () => {
        try {
            await studioLogout();
        } catch {
            // Local state must still be cleared if the session already expired.
        }
        setStudioUser(null);
        message.success(text.signedOut);
        navigate("/login", { replace: true });
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins && !isStudioManagedHost() ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label="节点插件" title="节点插件">
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            {isStudioManagedHost() && studioUser ? (
                <div
                    className={cn(
                        "relative mr-2 hidden items-center gap-2 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700 shadow-sm transition-[transform,box-shadow,border-color,background-color] duration-300 md:inline-flex dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200",
                        pointsDeltaActive && pointsDeltaTone === "gain" && "border-emerald-300 bg-emerald-50/80 shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_10px_30px_-14px_rgba(16,185,129,0.65)] dark:border-emerald-700 dark:bg-emerald-950/40",
                        pointsDeltaActive && pointsDeltaTone === "loss" && "border-rose-300 bg-rose-50/80 shadow-[0_0_0_1px_rgba(244,63,94,0.12),0_10px_30px_-14px_rgba(244,63,94,0.65)] dark:border-rose-700 dark:bg-rose-950/40",
                        pointsDeltaActive && "animate-[studio-points-pill_0.7s_cubic-bezier(.22,1,.36,1)]",
                    )}
                >
                    <Tag className="m-0 hidden lg:inline-flex" color={studioUser.source === "mtline" ? "blue" : "green"}>
                        {studioUser.source === "mtline" ? "Mtline" : studioUser.source === "studio" ? "Admin" : "MassMore"}
                    </Tag>
                    <span className="hidden max-w-28 truncate xl:inline">{studioUser.username}</span>
                    <span
                        className={cn(
                            "relative inline-flex min-w-[6.75rem] items-center justify-end overflow-visible font-medium tabular-nums transition-[transform,color] duration-300 xl:min-w-[8.5rem]",
                            pointsDeltaActive ? "scale-[1.03]" : "scale-100",
                            pointsDeltaActive && pointsDeltaTone === "gain" && "text-emerald-600 dark:text-emerald-300",
                            pointsDeltaActive && pointsDeltaTone === "loss" && "text-rose-600 dark:text-rose-300",
                        )}
                    >
                        {formattedPoints} {text.credits}
                        {pointsDeltaActive ? (
                            <span
                                className={cn(
                                    "pointer-events-none absolute -bottom-1 right-0 h-0.5 w-full rounded-full opacity-80 animate-[studio-points-bar_1.1s_ease-out_forwards]",
                                    pointsDeltaTone === "gain" ? "bg-emerald-400" : "bg-rose-400",
                                )}
                            />
                        ) : null}
                        {pointsDeltaActive && pointsDelta ? (
                            <span
                                className={cn(
                                    "pointer-events-none absolute -top-5 right-0 whitespace-nowrap font-semibold tabular-nums animate-[studio-points-float_1.6s_ease-out_forwards]",
                                    pointsDelta.amount > 0 ? "text-emerald-500" : "text-rose-500",
                                )}
                            >
                                {formattedDelta}
                            </span>
                        ) : null}
                    </span>
                    <style>
                        {`@keyframes studio-points-float {
                            0% { opacity: 0; transform: translateY(8px) scale(0.96); }
                            15% { opacity: 1; transform: translateY(0) scale(1); }
                            80% { opacity: 1; transform: translateY(-10px) scale(1); }
                            100% { opacity: 0; transform: translateY(-16px) scale(1.02); }
                        }
                        @keyframes studio-points-pill {
                            0% { transform: translateY(0) scale(1); }
                            28% { transform: translateY(-1px) scale(1.035); }
                            55% { transform: translateY(0) scale(0.992); }
                            100% { transform: translateY(0) scale(1); }
                        }
                        @keyframes studio-points-bar {
                            0% { opacity: 0; transform: scaleX(0.12); transform-origin: right center; }
                            22% { opacity: 0.9; transform: scaleX(1); }
                            100% { opacity: 0; transform: scaleX(0.35); transform-origin: left center; }
                        }`}
                    </style>
                    {studioUser.rechargeUrl ? (
                        <a href={studioUser.rechargeUrl} target="_blank" rel="noopener noreferrer" className="hidden font-medium text-sky-600 xl:inline">
                            {text.topUp}
                        </a>
                    ) : null}
                </div>
            ) : null}
            {isStudioManagedHost() && studioUser?.role === "studio_admin" ? (
                <Link to="/admin" className={naturalIconClass} style={iconStyle} aria-label={text.admin} title={text.admin}>
                    <Shield className="size-4" />
                </Link>
            ) : null}
            {isStudioManagedHost() && studioUser ? (
                <Link to="/usage" className={naturalIconClass} style={iconStyle} aria-label={text.usage} title={text.usage}>
                    <History className="size-4" />
                </Link>
            ) : null}
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label={text.docs} title={text.docs}>
                <BookOpen className="size-4" />
            </a>
            {showConfig && !isStudioManagedHost() ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label={text.settings} title={text.settings}>
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={theme === "dark" ? text.toLight : text.toDark}
                title={theme === "dark" ? text.toLight : text.toDark}
            />
            {!isStudioManagedHost() ? <VersionReleaseModal style={versionStyle} /> : null}
            {!isStudioManagedHost() ? <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} /> : null}
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={text.shortcuts} title={text.shortcuts}>
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {isStudioManagedHost() && studioUser ? (
                <Button type="text" size="small" className="!h-7 !w-7 !min-w-7" icon={<LogOut className="size-4" />} onClick={() => void logout()} title={text.signOut} />
            ) : null}
        </div>
    );
}
