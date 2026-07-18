import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isStudioManagedHost } from "@/services/studio-managed";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";

export function StudioProtectedRoute({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
    const location = useLocation();
    const user = useStudioSessionStore((state) => state.user);
    const bootstrapped = useStudioSessionStore((state) => state.bootstrapped);

    if (!isStudioManagedHost()) return <>{children}</>;
    if (!bootstrapped) return <FullPageStatus title="正在检查登录状态" />;
    if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
    if (admin && user.role !== "studio_admin") return <Navigate to="/" replace />;
    return <>{children}</>;
}

export function StudioPublicOnlyRoute({ children }: { children: ReactNode }) {
    const user = useStudioSessionStore((state) => state.user);
    const bootstrapped = useStudioSessionStore((state) => state.bootstrapped);
    if (!isStudioManagedHost()) return <>{children}</>;
    if (!bootstrapped) return <FullPageStatus title="正在检查登录状态" />;
    if (user) return <Navigate to="/" replace />;
    return <>{children}</>;
}

function FullPageStatus({ title }: { title: string }) {
    return (
        <div className="grid h-dvh place-items-center bg-stone-950 text-white">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-sm shadow-2xl backdrop-blur">
                {title}
            </div>
        </div>
    );
}
