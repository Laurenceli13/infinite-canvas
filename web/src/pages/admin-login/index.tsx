import { App, Button, Card, Form, Input, Segmented } from "antd";
import { useNavigate } from "react-router-dom";

import { studioAdminLogin } from "@/services/studio-managed";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";
import { useStudioSessionStore } from "@/stores/use-studio-session-store";

export default function AdminLoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const locale = useStudioLocaleStore((state) => state.locale);
    const setLocale = useStudioLocaleStore((state) => state.setLocale);
    const setUser = useStudioSessionStore((state) => state.setUser);

    const copy =
        locale === "zh"
            ? {
                  title: "Studio 管理后台",
                  subtitle: "配置供应商、模型目录和积分定价。",
                  username: "管理员账号",
                  usernameRequired: "请输入管理员账号",
                  password: "管理员密码",
                  passwordRequired: "请输入管理员密码",
                  login: "登录",
                  error: "管理员登录失败",
              }
            : {
                  title: "Studio Admin",
                  subtitle: "Manage providers, model catalog, and credit pricing.",
                  username: "Admin Username",
                  usernameRequired: "Please enter the admin username",
                  password: "Admin Password",
                  passwordRequired: "Please enter the admin password",
                  login: "Sign in",
                  error: "Admin sign-in failed",
              };

    const submit = async (values: { username: string; password: string }) => {
        try {
            const result = await studioAdminLogin(values.username, values.password);
            if (result.user) setUser(result.user);
            navigate("/admin", { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.error);
        }
    };

    return (
        <main className="grid min-h-dvh place-items-center bg-stone-950 px-4 py-10 text-white">
            <Card className="w-full max-w-sm border-0 shadow-2xl" styles={{ body: { padding: 28 } }}>
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <div className="text-2xl font-semibold text-stone-950">{copy.title}</div>
                        <div className="mt-2 text-sm text-stone-500">{copy.subtitle}</div>
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
                <Form layout="vertical" requiredMark={false} onFinish={submit}>
                    <Form.Item name="username" label={copy.username} rules={[{ required: true, message: copy.usernameRequired }]}>
                        <Input size="large" autoComplete="username" />
                    </Form.Item>
                    <Form.Item name="password" label={copy.password} rules={[{ required: true, message: copy.passwordRequired }]}>
                        <Input.Password size="large" autoComplete="current-password" />
                    </Form.Item>
                    <Button type="primary" size="large" htmlType="submit" block>
                        {copy.login}
                    </Button>
                </Form>
            </Card>
        </main>
    );
}
