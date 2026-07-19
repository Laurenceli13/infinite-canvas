import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import AdminPage from "@/pages/admin";
import AdminLoginPage from "@/pages/admin-login";
import { StudioProtectedRoute, StudioPublicOnlyRoute } from "@/components/layout/studio-route-guards";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import UsagePage from "@/pages/usage";
import VideoPage from "@/pages/video";

export const router = createBrowserRouter([
    {
        path: "/login",
        element: (
            <StudioPublicOnlyRoute>
                <LoginPage />
            </StudioPublicOnlyRoute>
        ),
    },
    {
        path: "/admin/login",
        element: (
            <StudioPublicOnlyRoute>
                <AdminLoginPage />
            </StudioPublicOnlyRoute>
        ),
    },
    {
        element: (
            <StudioProtectedRoute>
                <UserLayout>
                    <AnalyticsTracker />
                    <Outlet />
                </UserLayout>
            </StudioProtectedRoute>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/usage", element: <UsagePage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
        ],
    },
    {
        element: (
            <StudioProtectedRoute admin>
                <UserLayout>
                    <Outlet />
                </UserLayout>
            </StudioProtectedRoute>
        ),
        children: [{ path: "/admin", element: <AdminPage /> }],
    },
    { path: "*", element: <NotFound /> },
]);
