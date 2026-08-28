"use client";

import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Segmented, Space } from "antd";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { fetchCurrentUser } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { isStudioManagedHost, studioAdminLogin, studioLogin, studioMtline2fa, type StudioUser } from "@/services/studio-managed";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";

type LoginFormValues = {
    username: string;
    password: string;
    confirmPassword?: string;
    code?: string;
};

function studioCanvasUser(user: StudioUser) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.username,
        avatarUrl: "",
        role: user.role === "studio_admin" ? "admin" as const : "user" as const,
        credits: Number(user.points || 0),
        createdAt: "",
        updatedAt: "",
    };
}

// 仅放行站内相对路径，拦截开放重定向。浏览器会忽略 URL 中的 Tab/换行/回车，并把
// //host 或 /\host 解析为协议相对的跨站地址，因此先剥离控制字符，再拒绝 // 与 /\ 前缀。
function safeRedirect(value: string | null): string {
    const cleaned = (value ?? "").replace(/[\t\n\r]/g, "");
    if (!cleaned.startsWith("/") || cleaned.startsWith("//") || cleaned.startsWith("/\\")) {
        return "/";
    }
    return cleaned;
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginContent />
        </Suspense>
    );
}

function LoginContent() {
    const { message } = App.useApp();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const login = useUserStore((state) => state.login);
    const register = useUserStore((state) => state.register);
    const setSession = useUserStore((state) => state.setSession);
    const isLoading = useUserStore((state) => state.isLoading);
    const linuxDoEnabled = useConfigStore((state) => state.publicSettings?.auth?.linuxDo?.enabled === true);
    const allowRegister = useConfigStore((state) => state.publicSettings?.auth?.allowRegister !== false);
    const [mode, setMode] = useState<"login" | "register">("login");
    const [studioSource, setStudioSource] = useState<"massmore" | "mtline">("massmore");
    const [pendingMtlineToken, setPendingMtlineToken] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [hostReady, setHostReady] = useState(false);
    const redirect = safeRedirect(searchParams.get("redirect"));
    const studioHost = hostReady && isStudioManagedHost();
    const adminLogin = studioHost && pathname === "/admin/login";

    useEffect(() => {
        setHostReady(true);
    }, []);

    useEffect(() => {
        if (!hostReady) return;
        const token = searchParams.get("token");
        const error = searchParams.get("error");
        if (studioHost) return;
        if (error) message.error(error);
        if (!token) return;
        void fetchCurrentUser(token).then((user) => {
            setSession(token, user);
            message.success("登录成功");
            router.replace(redirect);
            router.refresh();
        });
    }, [hostReady, message, redirect, router, searchParams, setSession, studioHost]);

    useEffect(() => {
        if (!allowRegister && mode === "register") setMode("login");
    }, [allowRegister, mode]);

    if (!hostReady) return null;

    const submit = async (values: LoginFormValues) => {
        try {
            if (studioHost) {
                setSubmitting(true);
                let studioUser: StudioUser | undefined;
                if (adminLogin) {
                    const result = await studioAdminLogin(values.username, values.password);
                    studioUser = result.user;
                    if (!studioUser) throw new Error(result.message || "管理员登录失败");
                } else if (pendingMtlineToken) {
                    const result = await studioMtline2fa(pendingMtlineToken, values.code || "");
                    studioUser = result.user;
                    if (!studioUser) throw new Error(result.message || "验证码无效");
                } else {
                    const result = await studioLogin(studioSource, values.username, values.password);
                    if (result.require2fa && result.pendingToken) {
                        setPendingMtlineToken(result.pendingToken);
                        message.info("请输入 Mtline 两步验证码");
                        return;
                    }
                    studioUser = result.user;
                    if (!studioUser) throw new Error(result.message || "登录失败");
                }
                useStudioSessionStore.getState().setUser(studioUser);
                useStudioSessionStore.getState().setReady(true);
                setSession("studio-session", studioCanvasUser(studioUser));
                message.success("登录成功");
                router.replace(redirect);
                router.refresh();
                return;
            }
            if (mode === "register" && !allowRegister) {
                message.error("当前未开放注册");
                return;
            }
            if (mode === "register" && values.password !== values.confirmPassword) {
                message.error("两次输入的密码不一致");
                return;
            }
            const action = mode === "register" ? register : login;
            const user = await action({ username: values.username, password: values.password });
            message.success(mode === "register" ? "注册成功" : "登录成功");
            router.replace(redirect);
            router.refresh();
            if (user.role !== "admin") router.replace("/");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-10 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <section className="w-full max-w-[420px]">
                <div className="mb-7 text-center">
                    <span
                        className="mx-auto mb-4 block size-12 bg-stone-950 dark:bg-stone-100"
                        style={{
                            mask: "url(/logo.svg) center / contain no-repeat",
                            WebkitMask: "url(/logo.svg) center / contain no-repeat",
                        }}
                        aria-label="无限画布"
                    />
                    <h1 className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-100">{adminLogin ? "管理员登录" : "账号登录"}</h1>
                    <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">{adminLogin ? "使用 Studio 管理员账户登录。" : studioHost ? "使用 MassMore 或 Mtline 账户登录。" : "支持账号密码和 Linux.do 登录。"}</p>
                </div>

                <Form<LoginFormValues> layout="vertical" size="large" requiredMark={false} onFinish={submit}>
                    {!studioHost || adminLogin ? <Form.Item>
                        <Segmented
                            block
                            value={mode}
                            onChange={(value) => setMode(value as "login" | "register")}
                            options={!adminLogin && allowRegister ? [{ label: "登录", value: "login" }, { label: "注册", value: "register" }] : [{ label: "登录", value: "login" }]}
                        />
                        </Form.Item> : <Form.Item>
                            <Segmented block value={studioSource} onChange={(value) => { setStudioSource(value as "massmore" | "mtline"); setPendingMtlineToken(""); }} options={[{ label: "MassMore", value: "massmore" }, { label: "Mtline", value: "mtline" }]} />
                        </Form.Item>}
                    {!pendingMtlineToken ? <><Form.Item name="username" label={<span className="font-medium text-stone-800 dark:text-stone-200">用户名</span>} rules={[{ required: true, message: "请输入用户名" }]}>
                        <Input prefix={<UserOutlined />} autoComplete="username" />
                    </Form.Item>
                    <Form.Item name="password" label={<span className="font-medium text-stone-800 dark:text-stone-200">密码</span>} rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
                    </Form.Item></> : <Form.Item name="code" label={<span className="font-medium text-stone-800 dark:text-stone-200">两步验证码</span>} rules={[{ required: true, message: "请输入验证码" }]}>
                        <Input inputMode="numeric" autoComplete="one-time-code" />
                    </Form.Item>}
                    {!studioHost && !adminLogin && mode === "register" ? (
                        <Form.Item name="confirmPassword" label={<span className="font-medium text-stone-800 dark:text-stone-200">确认密码</span>} rules={[{ required: true, message: "请再次输入密码" }]}>
                            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
                        </Form.Item>
                    ) : null}
                    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                        <Button block type="primary" htmlType="submit" loading={studioHost ? submitting : isLoading}>
                            {pendingMtlineToken ? "确认验证" : adminLogin ? "管理员登录" : mode === "register" ? "注册" : "登录"}
                        </Button>
                        {!studioHost && linuxDoEnabled ? (
                            <Button block href={`/api/auth/linux-do/authorize?redirect=${encodeURIComponent(redirect)}`} icon={<img src="/icons/linuxdo.svg" alt="" width={18} height={18} />}>
                                使用 Linux.do 登录
                            </Button>
                        ) : null}
                    </Space>
                </Form>
            </section>
        </main>
    );
}
