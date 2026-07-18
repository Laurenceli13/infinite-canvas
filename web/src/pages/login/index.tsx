import { App, Button, Card, Form, Input, Segmented } from "antd";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchStudioCatalog, catalogToConfigPatch, studioLogin, studioMtline2fa, type StudioUser } from "@/services/studio-managed";
import { useConfigStore } from "@/stores/use-config-store";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";

type LoginSource = "massmore" | "mtline";

const REGISTER_URLS: Record<LoginSource, string> = {
    massmore: "https://massmore.org/register",
    mtline: "https://mtline.cc/register",
};

export default function LoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const locale = useStudioLocaleStore((state) => state.locale);
    const setLocale = useStudioLocaleStore((state) => state.setLocale);
    const [source, setSource] = useState<LoginSource>("massmore");
    const [loading, setLoading] = useState(false);
    const [pendingToken, setPendingToken] = useState("");
    const setUser = useStudioSessionStore((state) => state.setUser);
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const from = typeof location.state === "object" && location.state && "from" in location.state ? String(location.state.from || "/") : "/";

    const copy =
        locale === "zh"
            ? {
                  title: "MassMore Studio",
                  subtitle: "登录后统一使用平台模型目录，调用费用按原站余额换算成 Studio 积分。",
                  massmore: "MassMore 登录",
                  mtline: "Mtline 登录",
                  username: "账号 / 邮箱",
                  usernameRequired: "请输入账号或邮箱",
                  password: "密码",
                  passwordRequired: "请输入密码",
                  login: "登录 Studio",
                  noAccount: "还没有账号？",
                  registerMassmore: "前往 MassMore 注册",
                  registerMtline: "前往 Mtline 注册",
                  need2fa: "Mtline 账号需要二次验证，请输入 2FA 验证码。",
                  loginSuccess: "登录成功",
                  loginError: "登录失败",
                  code: "Mtline 2FA 验证码",
                  codeRequired: "请输入 2FA 验证码",
                  finish2fa: "完成验证",
                  back: "返回重新登录",
                  admin: "Studio 管理员入口",
                  cacheNotice: "作品会持久保存在当前浏览器中。清理浏览器数据或更换设备不会同步作品，请定期导出重要画布和素材备份。",
                  verifyError: "2FA 验证失败",
              }
            : {
                  title: "MassMore Studio",
                  subtitle: "Sign in to use the managed model catalog with billing mapped from your source account balance into Studio credits.",
                  massmore: "MassMore Login",
                  mtline: "Mtline Login",
                  username: "Username / Email",
                  usernameRequired: "Please enter your username or email",
                  password: "Password",
                  passwordRequired: "Please enter your password",
                  login: "Sign in to Studio",
                  noAccount: "No account yet?",
                  registerMassmore: "Register on MassMore",
                  registerMtline: "Register on Mtline",
                  need2fa: "This Mtline account requires 2FA. Enter the verification code to continue.",
                  loginSuccess: "Signed in successfully",
                  loginError: "Sign-in failed",
                  code: "Mtline 2FA Code",
                  codeRequired: "Please enter the 2FA code",
                  finish2fa: "Complete Verification",
                  back: "Back to Login",
                  admin: "Studio Admin",
                  cacheNotice: "Your work remains stored in this browser. Clearing browser data or switching devices will not carry it over, so export important canvases and media regularly.",
                  verifyError: "2FA verification failed",
              };

    const afterLogin = async (user?: StudioUser) => {
        if (user) setUser(user);
        const models = await fetchStudioCatalog();
        const patch = catalogToConfigPatch(config, models);
        (Object.keys(patch) as Array<keyof typeof patch>).forEach((key) => updateConfig(key as never, patch[key] as never));
        navigate(from, { replace: true });
    };

    const submitLogin = async (values: { username: string; password: string }) => {
        setLoading(true);
        try {
            const result = await studioLogin(source, values.username, values.password);
            if (result.require2fa && result.pendingToken) {
                setPendingToken(result.pendingToken);
                message.info(copy.need2fa);
                return;
            }
            await afterLogin(result.user);
            message.success(copy.loginSuccess);
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.loginError);
        } finally {
            setLoading(false);
        }
    };

    const submit2fa = async (values: { code: string }) => {
        setLoading(true);
        try {
            const result = await studioMtline2fa(pendingToken, values.code);
            await afterLogin(result.user);
            message.success(copy.loginSuccess);
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.verifyError);
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top,#e0f2fe,transparent_38%),linear-gradient(135deg,#0f172a,#1e293b)] px-4 py-10">
            <Card className="w-full max-w-md border-0 shadow-2xl" styles={{ body: { padding: 28 } }}>
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <div className="text-2xl font-semibold text-stone-950">{copy.title}</div>
                        <div className="mt-2 text-sm leading-6 text-stone-500">{copy.subtitle}</div>
                    </div>
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
                {!pendingToken ? (
                    <>
                        <Segmented<LoginSource>
                            block
                            className="mb-5"
                            value={source}
                            onChange={setSource}
                            options={[
                                { label: copy.massmore, value: "massmore" },
                                { label: copy.mtline, value: "mtline" },
                            ]}
                        />
                        <Form layout="vertical" requiredMark={false} onFinish={submitLogin}>
                            <Form.Item name="username" label={copy.username} rules={[{ required: true, message: copy.usernameRequired }]}>
                                <Input size="large" autoComplete="username" />
                            </Form.Item>
                            <Form.Item name="password" label={copy.password} rules={[{ required: true, message: copy.passwordRequired }]}>
                                <Input.Password size="large" autoComplete="current-password" />
                            </Form.Item>
                            <Button type="primary" size="large" htmlType="submit" loading={loading} block>
                                {copy.login}
                            </Button>
                        </Form>
                        <div className="mt-4 text-center text-sm text-stone-500">
                            {copy.noAccount}
                            <a href={REGISTER_URLS[source]} target="_blank" rel="noopener noreferrer" className="ml-1 font-medium text-sky-600 hover:text-sky-500">
                                {source === "massmore" ? copy.registerMassmore : copy.registerMtline}
                            </a>
                        </div>
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{copy.cacheNotice}</div>
                    </>
                ) : (
                    <Form layout="vertical" requiredMark={false} onFinish={submit2fa}>
                        <Form.Item name="code" label={copy.code} rules={[{ required: true, message: copy.codeRequired }]}>
                            <Input size="large" autoComplete="one-time-code" />
                        </Form.Item>
                        <Button type="primary" size="large" htmlType="submit" loading={loading} block>
                            {copy.finish2fa}
                        </Button>
                        <Button className="mt-3" block onClick={() => setPendingToken("")}>
                            {copy.back}
                        </Button>
                    </Form>
                )}
                <Button type="link" className="mt-4 px-0" onClick={() => navigate("/admin/login")}>
                    {copy.admin}
                </Button>
            </Card>
        </main>
    );
}
