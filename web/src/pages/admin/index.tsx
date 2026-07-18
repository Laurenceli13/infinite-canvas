import { App, Button, Card, Collapse, DatePicker, Form, Input, InputNumber, Popconfirm, Segmented, Select, Space, Switch, Table, Tabs, Tag, Tooltip } from "antd";
import { useEffect, useMemo, useState } from "react";

import { defaultPricingRules, imageQualityItems, imageSizeTierItems, normalizePricingRules, videoResolutionItems, type PricingEntry, type StudioPricingRules } from "@/lib/studio-pricing";
import { createDefaultStudioProviderAdvancedConfig, createStudioProviderPayloadDefaults, type StudioProviderProtocolTemplate } from "@/services/studio-managed.provider-config";
import {
    createStudioModel,
    createStudioProvider,
    deleteStudioModel,
    deleteStudioProvider,
    fetchStudioConcurrency,
    fetchStudioAdminModels,
    fetchStudioAdminWorkflows,
    fetchStudioProviders,
    fetchStudioUsage,
    fetchStudioWorkflowUsers,
    refundStudioUsage,
    resetStudioUserConcurrency,
    updateStudioModel,
    updateStudioDefaultConcurrency,
    updateStudioProvider,
    updateStudioUsageReport,
    updateStudioUserConcurrency,
    updateStudioWorkflow,
    type StudioModel,
    type StudioConcurrencyConfig,
    type StudioConcurrencyUser,
    type StudioProvider,
    type StudioProviderPayload,
    type StudioUsage,
    type StudioWorkflow,
    type StudioWorkflowUserOption,
} from "@/services/studio-managed";
import { API_FORMAT_OPTIONS, type ApiCallFormat, type ModelCapability } from "@/stores/use-config-store";
import { useStudioLocaleStore, type StudioLocale } from "@/stores/use-studio-locale-store";

const capabilityOptions: Array<{ label: string; value: ModelCapability }> = [
    { label: "Text", value: "text" },
    { label: "Image", value: "image" },
    { label: "Video", value: "video" },
    { label: "Audio", value: "audio" },
];

const ADMIN_COPY: Record<
    StudioLocale,
    {
        pageTitle: string;
        pageSubtitle: string;
        languageLabel: string;
        tabs: { providers: string; models: string; usage: string };
        providers: {
            createTitle: string;
            editTitle: string;
            cancel: string;
            providerName: string;
            baseUrl: string;
            apiKey: string;
            apiKeyEdit: string;
            requestFormat: string;
            enabled: string;
            advanced: string;
            protocolTemplate: string;
            isAsync: string;
            createPath: string;
            pollPathTemplate: string;
            contentPathTemplate: string;
            taskIdField: string;
            statusField: string;
            resultUrlField: string;
            completedStatuses: string;
            failedStatuses: string;
            downloadResult: string;
            authMode: string;
            authHeaderName: string;
            authQueryName: string;
            extraHeaders: string;
            extraHeadersPlaceholder: string;
            completedPlaceholder: string;
            failedPlaceholder: string;
            save: string;
            create: string;
            reset: string;
            listTitle: string;
            columns: { name: string; baseUrl: string; format: string; mode: string; enabled: string; actions: string };
            modeAsync: string;
            modeSync: string;
            edit: string;
            delete: string;
            deleteConfirm: string;
            messages: {
                loadError: string;
                updateSuccess: string;
                createSuccess: string;
                deleteSuccess: string;
                invalidHeaders: string;
                saveError: string;
                toggleError: string;
                deleteError: string;
            };
            protocolOptions: Record<StudioProviderProtocolTemplate, string>;
            authOptions: { bearer: string; header: string; query: string };
        };
        models: {
            createTitle: string;
            editTitle: string;
            cancel: string;
            provider: string;
            modelId: string;
            displayName: string;
            capability: string;
            creditCost: string;
            enabled: string;
            create: string;
            save: string;
            catalogTitle: string;
            columns: { model: string; displayName: string; provider: string; capability: string; credits: string; enabled: string; actions: string };
            edit: string;
            delete: string;
            deleteConfirm: string;
            messages: { loadError: string; createSuccess: string; updateSuccess: string; deleteSuccess: string; createError: string; updateCreditError: string; updateStatusError: string; deleteError: string };
        };
        usage: {
            title: string;
            refresh: string;
            columns: { time: string; source: string; user: string; model: string; capability: string; quantity: string; credits: string; elapsed: string; balanceDelta: string; status: string; error: string };
            messages: { loadError: string };
        };
    }
> = {
    zh: {
        pageTitle: "Studio 管理后台",
        pageSubtitle: "管理供应商、模型目录、积分定价与近期使用记录。",
        languageLabel: "语言",
        tabs: { providers: "供应商配置", models: "模型配置", usage: "使用记录" },
        providers: {
            createTitle: "新建供应商",
            editTitle: "编辑供应商",
            cancel: "取消编辑",
            providerName: "供应商名称",
            baseUrl: "Base URL",
            apiKey: "API Key",
            apiKeyEdit: "API Key（留空则保留当前值）",
            requestFormat: "请求格式",
            enabled: "启用",
            advanced: "高级配置",
            protocolTemplate: "协议模板",
            isAsync: "异步任务",
            createPath: "创建路径",
            pollPathTemplate: "轮询路径模板",
            contentPathTemplate: "内容路径模板",
            taskIdField: "任务 ID 字段",
            statusField: "状态字段",
            resultUrlField: "结果链接字段",
            completedStatuses: "完成状态集合",
            failedStatuses: "失败状态集合",
            downloadResult: "完成后直接下载结果",
            authMode: "鉴权方式",
            authHeaderName: "鉴权 Header 名称",
            authQueryName: "鉴权 Query 名称",
            extraHeaders: "附加请求头",
            extraHeadersPlaceholder: '{"X-Provider-Version":"2024-01"}',
            completedPlaceholder: "succeeded, completed",
            failedPlaceholder: "failed, error, cancelled",
            save: "保存供应商",
            create: "创建供应商",
            reset: "重置表单",
            listTitle: "供应商列表",
            columns: { name: "名称", baseUrl: "Base URL", format: "格式", mode: "模式", enabled: "启用", actions: "操作" },
            modeAsync: "异步",
            modeSync: "同步",
            edit: "编辑",
            delete: "删除",
            deleteConfirm: "确认删除这个供应商？它下面的模型也会一起删除。",
            messages: {
                loadError: "加载供应商失败",
                updateSuccess: "供应商已更新",
                createSuccess: "供应商已创建",
                deleteSuccess: "供应商已删除",
                invalidHeaders: "附加请求头必须是合法 JSON 对象",
                saveError: "保存供应商失败",
                toggleError: "更新供应商状态失败",
                deleteError: "删除供应商失败",
            },
            protocolOptions: {
                openai: "OpenAI 兼容",
                gemini: "Gemini 兼容",
                agnes: "AGNES Skill",
                openai_async: "OpenAI 异步视频",
                generic_async: "通用异步任务",
            },
            authOptions: { bearer: "Bearer Token", header: "自定义 Header", query: "Query 参数" },
        },
        models: {
            createTitle: "新建模型",
            editTitle: "编辑模型",
            cancel: "取消编辑",
            provider: "所属供应商",
            modelId: "模型 ID",
            displayName: "显示名称",
            capability: "能力类型",
            creditCost: "积分消耗",
            enabled: "启用",
            create: "创建模型",
            save: "保存模型",
            catalogTitle: "模型目录",
            columns: { model: "模型", displayName: "显示名称", provider: "供应商", capability: "能力", credits: "积分", enabled: "启用", actions: "操作" },
            edit: "编辑",
            delete: "删除",
            deleteConfirm: "确认删除这个模型？",
            messages: {
                loadError: "加载模型失败",
                createSuccess: "模型已创建",
                updateSuccess: "模型已更新",
                deleteSuccess: "模型已删除",
                createError: "创建模型失败",
                updateCreditError: "更新积分消耗失败",
                updateStatusError: "更新模型状态失败",
                deleteError: "删除模型失败",
            },
        },
        usage: {
            title: "近期使用记录",
            refresh: "刷新",
            columns: { time: "时间", source: "来源", user: "用户", model: "模型", capability: "能力", quantity: "数量", credits: "消耗积分", elapsed: "耗时", balanceDelta: "余额变化", status: "状态", error: "错误信息" },
            messages: { loadError: "加载使用记录失败" },
        },
    },
    en: {
        pageTitle: "Studio Admin",
        pageSubtitle: "Manage providers, model catalog, credit pricing, and recent usage.",
        languageLabel: "Language",
        tabs: { providers: "Providers", models: "Models", usage: "Usage" },
        providers: {
            createTitle: "Create Provider",
            editTitle: "Edit Provider",
            cancel: "Cancel",
            providerName: "Provider Name",
            baseUrl: "Base URL",
            apiKey: "API Key",
            apiKeyEdit: "API Key (leave blank to keep current value)",
            requestFormat: "Request Format",
            enabled: "Enabled",
            advanced: "Advanced Configuration",
            protocolTemplate: "Protocol Template",
            isAsync: "Async Task",
            createPath: "Create Path",
            pollPathTemplate: "Poll Path Template",
            contentPathTemplate: "Content Path Template",
            taskIdField: "Task ID Field",
            statusField: "Status Field",
            resultUrlField: "Result URL Field",
            completedStatuses: "Completed Statuses",
            failedStatuses: "Failed Statuses",
            downloadResult: "Download Result After Completion",
            authMode: "Auth Mode",
            authHeaderName: "Auth Header Name",
            authQueryName: "Auth Query Name",
            extraHeaders: "Extra Headers",
            extraHeadersPlaceholder: '{"X-Provider-Version":"2024-01"}',
            completedPlaceholder: "succeeded, completed",
            failedPlaceholder: "failed, error, cancelled",
            save: "Save Provider",
            create: "Create Provider",
            reset: "Reset Form",
            listTitle: "Provider List",
            columns: { name: "Name", baseUrl: "Base URL", format: "Format", mode: "Mode", enabled: "Enabled", actions: "Actions" },
            modeAsync: "Async",
            modeSync: "Sync",
            edit: "Edit",
            delete: "Delete",
            deleteConfirm: "Delete this provider? Its models will be deleted too.",
            messages: {
                loadError: "Failed to load providers",
                updateSuccess: "Provider updated",
                createSuccess: "Provider created",
                deleteSuccess: "Provider deleted",
                invalidHeaders: "Extra headers must be a valid JSON object",
                saveError: "Failed to save provider",
                toggleError: "Failed to update provider",
                deleteError: "Failed to delete provider",
            },
            protocolOptions: {
                openai: "OpenAI Compatible",
                gemini: "Gemini Compatible",
                agnes: "AGNES Skill",
                openai_async: "OpenAI Async Video",
                generic_async: "Generic Async Task",
            },
            authOptions: { bearer: "Bearer Token", header: "Custom Header", query: "Query Parameter" },
        },
        models: {
            createTitle: "Create Model",
            editTitle: "Edit Model",
            cancel: "Cancel",
            provider: "Provider",
            modelId: "Model ID",
            displayName: "Display Name",
            capability: "Capability",
            creditCost: "Credit Cost",
            enabled: "Enabled",
            create: "Create Model",
            save: "Save Model",
            catalogTitle: "Model Catalog",
            columns: { model: "Model", displayName: "Display Name", provider: "Provider", capability: "Capability", credits: "Credits", enabled: "Enabled", actions: "Actions" },
            edit: "Edit",
            delete: "Delete",
            deleteConfirm: "Delete this model?",
            messages: {
                loadError: "Failed to load models",
                createSuccess: "Model created",
                updateSuccess: "Model updated",
                deleteSuccess: "Model deleted",
                createError: "Failed to create model",
                updateCreditError: "Failed to update model credit cost",
                updateStatusError: "Failed to update model status",
                deleteError: "Failed to delete model",
            },
        },
        usage: {
            title: "Recent Usage",
            refresh: "Refresh",
            columns: { time: "Time", source: "Source", user: "User", model: "Model", capability: "Capability", quantity: "Quantity", credits: "Credits", elapsed: "Elapsed", balanceDelta: "Balance Delta", status: "Status", error: "Error" },
            messages: { loadError: "Failed to load usage" },
        },
    },
};

type ProviderFormValues = {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    enabled: boolean;
    protocolTemplate: StudioProviderProtocolTemplate;
    isAsync: boolean;
    createPath: string;
    pollPathTemplate: string;
    contentPathTemplate: string;
    taskIdField: string;
    statusField: string;
    resultUrlField: string;
    completedStatusesText: string;
    failedStatusesText: string;
    downloadResult: boolean;
    authMode: "bearer" | "header" | "query";
    authHeaderName: string;
    authQueryName: string;
    extraHeadersText: string;
};

function splitStatusValues(value: string) {
    return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function advancedConfigToFormValues(config: ReturnType<typeof createDefaultStudioProviderAdvancedConfig>) {
    return {
        protocolTemplate: config.protocolTemplate || "openai",
        isAsync: Boolean(config.isAsync),
        createPath: config.createPath || "",
        pollPathTemplate: config.pollPathTemplate || "",
        contentPathTemplate: config.contentPathTemplate || "",
        taskIdField: config.taskIdField || "",
        statusField: config.statusField || "",
        resultUrlField: config.resultUrlField || "",
        completedStatusesText: (config.completedStatuses || []).join(", "),
        failedStatusesText: (config.failedStatuses || []).join(", "),
        downloadResult: Boolean(config.downloadResult),
        authMode: config.authMode || "bearer",
        authHeaderName: config.authHeaderName || "",
        authQueryName: config.authQueryName || "",
        extraHeadersText: JSON.stringify(config.extraHeaders || {}, null, 2),
    };
}

export default function AdminPage() {
    const locale = useStudioLocaleStore((state) => state.locale);
    const setLocale = useStudioLocaleStore((state) => state.setLocale);
    const copy = ADMIN_COPY[locale];

    return (
        <main className="h-full overflow-y-auto bg-stone-50 p-4 text-stone-950 dark:bg-stone-950 dark:text-stone-100 md:p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h1 className="text-2xl font-semibold">{copy.pageTitle}</h1>
                        <p className="mt-1 text-sm text-stone-500">{copy.pageSubtitle}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-stone-500">{copy.languageLabel}</span>
                        <Segmented<StudioLocale>
                            value={locale}
                            onChange={(value) => setLocale(value)}
                            options={[
                                { label: "中文", value: "zh" },
                                { label: "English", value: "en" },
                            ]}
                        />
                    </div>
                </div>
                <Tabs
                    items={[
                        { key: "providers", label: copy.tabs.providers, children: <ProvidersTab locale={locale} /> },
                        { key: "models", label: copy.tabs.models, children: <ModelsTab locale={locale} /> },
                        { key: "workflows", label: locale === "zh" ? "工作流权限" : "Workflow access", children: <WorkflowsTab locale={locale} /> },
                        { key: "concurrency", label: locale === "zh" ? "并发限制" : "Concurrency", children: <ConcurrencyTab locale={locale} /> },
                        { key: "usage", label: copy.tabs.usage, children: <UsageTab locale={locale} /> },
                    ]}
                />
            </div>
        </main>
    );
}

function ConcurrencyTab({ locale }: { locale: StudioLocale }) {
    const { message } = App.useApp();
    const [config, setConfig] = useState<StudioConcurrencyConfig | null>(null);
    const [defaultDraft, setDefaultDraft] = useState(4);
    const [userDrafts, setUserDrafts] = useState<Record<string, number>>({});
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [savingKey, setSavingKey] = useState("");

    const userKey = (user: StudioConcurrencyUser) => `${user.source}:${user.userId}`;
    const load = async () => {
        setLoading(true);
        try {
            const next = await fetchStudioConcurrency();
            setConfig(next);
            setDefaultDraft(next.defaultLimit);
            setUserDrafts(Object.fromEntries(next.users.map((user) => [userKey(user), user.overrideLimit ?? user.effectiveLimit])));
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "并发配置加载失败" : "Failed to load concurrency settings");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const filteredUsers = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) return config?.users || [];
        return (config?.users || []).filter((user) =>
            [user.source, user.userId, user.username, user.email, user.label].some((value) => String(value || "").toLowerCase().includes(keyword)),
        );
    }, [config?.users, query]);

    const saveDefault = async () => {
        setSavingKey("default");
        try {
            await updateStudioDefaultConcurrency(defaultDraft);
            message.success(locale === "zh" ? "全局默认并发已更新" : "Default concurrency updated");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "保存失败" : "Save failed");
        } finally {
            setSavingKey("");
        }
    };

    const saveUser = async (user: StudioConcurrencyUser) => {
        const key = userKey(user);
        setSavingKey(key);
        try {
            await updateStudioUserConcurrency(user.source, user.userId, userDrafts[key] || config?.defaultLimit || 4);
            message.success(locale === "zh" ? "用户并发上限已更新" : "User concurrency updated");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "保存失败" : "Save failed");
        } finally {
            setSavingKey("");
        }
    };

    const resetUser = async (user: StudioConcurrencyUser) => {
        const key = userKey(user);
        setSavingKey(key);
        try {
            await resetStudioUserConcurrency(user.source, user.userId);
            message.success(locale === "zh" ? "已恢复使用全局默认值" : "Reset to the global default");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "重置失败" : "Reset failed");
        } finally {
            setSavingKey("");
        }
    };

    const maxLimit = config?.maxLimit || 64;
    return (
        <div className="space-y-4">
            <Card title={locale === "zh" ? "Studio 全局默认并发" : "Studio default concurrency"}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div>
                        <div className="mb-1 text-sm text-stone-500">{locale === "zh" ? "每个用户同时运行的生成任务数" : "Running generation jobs per user"}</div>
                        <InputNumber min={1} max={maxLimit} precision={0} value={defaultDraft} onChange={(value) => setDefaultDraft(Number(value || 1))} />
                    </div>
                    <Button type="primary" loading={savingKey === "default"} onClick={() => void saveDefault()}>
                        {locale === "zh" ? "保存全局设置" : "Save default"}
                    </Button>
                </div>
                <p className="mt-3 text-sm text-stone-500">
                    {locale === "zh"
                        ? "仅限制 Studio 用户的任务调度；不会修改 MassMore、Mtline 或 Cloudflare Worker 的并发设置。用户单独设置后优先使用用户值。"
                        : "This only limits Studio job scheduling. It does not change MassMore, Mtline, or Cloudflare Worker concurrency. User overrides take priority."}
                </p>
            </Card>
            <Card
                title={locale === "zh" ? "用户并发覆盖" : "Per-user overrides"}
                extra={<Button loading={loading} onClick={() => void load()}>{locale === "zh" ? "刷新" : "Refresh"}</Button>}
            >
                <Input.Search
                    allowClear
                    className="mb-4 max-w-md"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={locale === "zh" ? "搜索来源、用户名、邮箱或用户 ID" : "Search source, username, email, or user ID"}
                />
                <Table<StudioConcurrencyUser>
                    rowKey={(user) => userKey(user)}
                    loading={loading}
                    dataSource={filteredUsers}
                    pagination={{ pageSize: 20, showSizeChanger: true }}
                    scroll={{ x: 900 }}
                    columns={[
                        { title: locale === "zh" ? "来源" : "Source", dataIndex: "source", width: 100, render: (value) => <Tag>{String(value).toUpperCase()}</Tag> },
                        {
                            title: locale === "zh" ? "用户" : "User",
                            width: 250,
                            render: (_, user) => <div><div className="font-medium">{user.username || user.email || user.userId}</div><div className="text-xs text-stone-500">{user.email || user.userId}</div></div>,
                        },
                        { title: locale === "zh" ? "运行 / 排队" : "Running / queued", width: 130, render: (_, user) => `${user.running} / ${user.queued}` },
                        { title: locale === "zh" ? "当前上限" : "Effective", dataIndex: "effectiveLimit", width: 100 },
                        {
                            title: locale === "zh" ? "单独设置" : "Override",
                            width: 140,
                            render: (_, user) => {
                                const key = userKey(user);
                                return <InputNumber min={1} max={maxLimit} precision={0} value={userDrafts[key]} onChange={(value) => setUserDrafts((current) => ({ ...current, [key]: Number(value || 1) }))} />;
                            },
                        },
                        {
                            title: locale === "zh" ? "操作" : "Actions",
                            width: 200,
                            fixed: "right",
                            render: (_, user) => {
                                const key = userKey(user);
                                return <Space><Button type="primary" loading={savingKey === key} onClick={() => void saveUser(user)}>{locale === "zh" ? "保存" : "Save"}</Button><Button disabled={user.overrideLimit == null} onClick={() => void resetUser(user)}>{locale === "zh" ? "恢复默认" : "Reset"}</Button></Space>;
                            },
                        },
                    ]}
                />
            </Card>
        </div>
    );
}

function WorkflowsTab({ locale }: { locale: StudioLocale }) {
    const { message } = App.useApp();
    const [workflows, setWorkflows] = useState<StudioWorkflow[]>([]);
    const [userOptions, setUserOptions] = useState<StudioWorkflowUserOption[]>([]);
    const [drafts, setDrafts] = useState<Record<string, StudioWorkflow>>({});
    const [loading, setLoading] = useState(false);
    const [savingKey, setSavingKey] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const [nextWorkflows, nextUsers] = await Promise.all([fetchStudioAdminWorkflows(), fetchStudioWorkflowUsers()]);
            setWorkflows(nextWorkflows);
            setUserOptions(nextUsers);
            setDrafts(Object.fromEntries(nextWorkflows.map((item) => [item.key, item])));
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "工作流权限加载失败" : "Failed to load workflow access");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const patchDraft = (key: string, patch: Partial<StudioWorkflow>) => {
        setDrafts((current) => ({ ...current, [key]: { ...(current[key] || workflows.find((item) => item.key === key)!), ...patch } }));
    };

    const save = async (key: StudioWorkflow["key"]) => {
        const draft = drafts[key];
        if (!draft) return;
        setSavingKey(key);
        try {
            await updateStudioWorkflow(key, { enabled: draft.enabled, accessMode: draft.accessMode, allowedUsers: draft.allowedUsers });
            message.success(locale === "zh" ? "工作流权限已保存" : "Workflow access saved");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "保存失败" : "Save failed");
        } finally {
            setSavingKey("");
        }
    };

    return (
        <Card
            title={locale === "zh" ? "行业工作流开放范围" : "Industry workflow access"}
            extra={<Button onClick={() => void load()}>{locale === "zh" ? "刷新" : "Refresh"}</Button>}
        >
            <Table
                rowKey="key"
                loading={loading}
                dataSource={workflows}
                pagination={false}
                scroll={{ x: 900 }}
                columns={[
                    {
                        title: locale === "zh" ? "套组" : "Suite",
                        width: 220,
                        render: (_, item) => (
                            <div className="min-w-0">
                                <div className="font-medium">{item.name}</div>
                                <div className="mt-1 text-xs text-stone-500">{item.description}</div>
                            </div>
                        ),
                    },
                    {
                        title: locale === "zh" ? "启用" : "Enabled",
                        width: 90,
                        render: (_, item) => <Switch checked={drafts[item.key]?.enabled ?? item.enabled} onChange={(enabled) => patchDraft(item.key, { enabled })} />,
                    },
                    {
                        title: locale === "zh" ? "开放范围" : "Access",
                        width: 150,
                        render: (_, item) => (
                            <Select
                                className="w-full"
                                value={drafts[item.key]?.accessMode || item.accessMode}
                                options={[
                                    { value: "all", label: locale === "zh" ? "全部用户" : "All users" },
                                    { value: "selected", label: locale === "zh" ? "指定用户" : "Selected users" },
                                ]}
                                onChange={(accessMode) => patchDraft(item.key, { accessMode })}
                            />
                        ),
                    },
                    {
                        title: locale === "zh" ? "授权用户" : "Allowed users",
                        width: 360,
                        render: (_, item) => {
                            const draft = drafts[item.key] || item;
                            return (
                                <Select
                                    mode="tags"
                                    className="w-full"
                                    disabled={draft.accessMode === "all"}
                                    value={draft.allowedUsers}
                                    placeholder={locale === "zh" ? "选择或输入用户名、邮箱、来源:用户名" : "Select or enter username, email, or source:user"}
                                    options={userOptions.map((user) => ({ value: user.value, label: user.label }))}
                                    onChange={(allowedUsers) => patchDraft(item.key, { allowedUsers })}
                                />
                            );
                        },
                    },
                    {
                        title: locale === "zh" ? "操作" : "Action",
                        width: 100,
                        fixed: "right",
                        render: (_, item) => (
                            <Button type="primary" loading={savingKey === item.key} onClick={() => void save(item.key)}>
                                {locale === "zh" ? "保存" : "Save"}
                            </Button>
                        ),
                    },
                ]}
            />
        </Card>
    );
}

function ProvidersTab({ locale }: { locale: StudioLocale }) {
    const { message } = App.useApp();
    const copy = ADMIN_COPY[locale].providers;
    const [providers, setProviders] = useState<StudioProvider[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [updatingProviderIds, setUpdatingProviderIds] = useState<number[]>([]);
    const [editingProviderId, setEditingProviderId] = useState<number | null>(null);
    const [form] = Form.useForm<ProviderFormValues>();

    const defaultPayload = createStudioProviderPayloadDefaults();
    const initialProviderValues: ProviderFormValues = {
        name: "",
        baseUrl: "",
        apiKey: "",
        apiFormat: defaultPayload.apiFormat,
        enabled: defaultPayload.enabled,
        ...advancedConfigToFormValues(defaultPayload),
    };

    const load = async () => {
        setLoading(true);
        try {
            setProviders(await fetchStudioProviders());
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.loadError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        form.setFieldsValue(initialProviderValues);
        void load();
    }, [form]);

    const resetProviderForm = () => {
        setEditingProviderId(null);
        form.resetFields();
        form.setFieldsValue(initialProviderValues);
    };

    const applyRecommendedDefaults = (apiFormat: ApiCallFormat) => {
        form.setFieldsValue({
            apiFormat,
            ...advancedConfigToFormValues(createDefaultStudioProviderAdvancedConfig(apiFormat)),
        });
    };

    const providerToFormValues = (provider: StudioProvider): ProviderFormValues => ({
        name: provider.name,
        baseUrl: provider.base_url,
        apiKey: "",
        apiFormat: provider.api_format,
        enabled: Boolean(provider.enabled),
        protocolTemplate: provider.protocol_template || initialProviderValues.protocolTemplate,
        isAsync: Boolean(provider.is_async),
        createPath: provider.create_path || initialProviderValues.createPath,
        pollPathTemplate: provider.poll_path_template || initialProviderValues.pollPathTemplate,
        contentPathTemplate: provider.content_path_template || initialProviderValues.contentPathTemplate,
        taskIdField: provider.task_id_field || initialProviderValues.taskIdField,
        statusField: provider.status_field || initialProviderValues.statusField,
        resultUrlField: provider.result_url_field || initialProviderValues.resultUrlField,
        completedStatusesText: (provider.completed_statuses || []).join(", "),
        failedStatusesText: (provider.failed_statuses || []).join(", "),
        downloadResult: Boolean(provider.download_result),
        authMode: provider.auth_mode || initialProviderValues.authMode,
        authHeaderName: provider.auth_header_name || initialProviderValues.authHeaderName,
        authQueryName: provider.auth_query_name || initialProviderValues.authQueryName,
        extraHeadersText: JSON.stringify(provider.extra_headers || {}, null, 2),
    });

    const buildProviderPayload = (values: ProviderFormValues): Omit<StudioProviderPayload, "name" | "baseUrl" | "apiKey"> => ({
        apiFormat: values.apiFormat,
        enabled: values.enabled,
        protocolTemplate: values.protocolTemplate,
        isAsync: values.isAsync,
        createPath: values.createPath.trim(),
        pollPathTemplate: values.pollPathTemplate.trim(),
        contentPathTemplate: values.contentPathTemplate.trim(),
        taskIdField: values.taskIdField.trim(),
        statusField: values.statusField.trim(),
        resultUrlField: values.resultUrlField.trim(),
        completedStatuses: splitStatusValues(values.completedStatusesText),
        failedStatuses: splitStatusValues(values.failedStatusesText),
        downloadResult: values.downloadResult,
        authMode: values.authMode,
        authHeaderName: values.authHeaderName.trim(),
        authQueryName: values.authQueryName.trim(),
        extraHeaders: values.extraHeadersText.trim() ? (JSON.parse(values.extraHeadersText) as Record<string, string>) : {},
    });

    const handleSubmit = async (values: ProviderFormValues) => {
        try {
            setSaving(true);
            const payload = buildProviderPayload(values);

            if (editingProviderId) {
                const updatePayload: Partial<StudioProviderPayload> = {
                    name: values.name.trim(),
                    baseUrl: values.baseUrl.trim(),
                    ...payload,
                };
                if (values.apiKey.trim()) {
                    updatePayload.apiKey = values.apiKey.trim();
                }
                await updateStudioProvider(editingProviderId, updatePayload);
                message.success(copy.messages.updateSuccess);
            } else {
                await createStudioProvider({
                    name: values.name.trim(),
                    baseUrl: values.baseUrl.trim(),
                    apiKey: values.apiKey.trim(),
                    ...payload,
                });
                message.success(copy.messages.createSuccess);
            }

            resetProviderForm();
            await load();
        } catch (error) {
            if (error instanceof SyntaxError) {
                message.error(copy.messages.invalidHeaders);
                return;
            }
            message.error(error instanceof Error ? error.message : copy.messages.saveError);
        } finally {
            setSaving(false);
        }
    };

    const handleToggleEnabled = async (provider: StudioProvider, enabled: boolean) => {
        const previousEnabled = Boolean(provider.enabled);
        setProviders((current) => current.map((item) => (item.id === provider.id ? { ...item, enabled: enabled ? 1 : 0 } : item)));
        setUpdatingProviderIds((current) => [...current, provider.id]);
        try {
            await updateStudioProvider(provider.id, { enabled });
            if (editingProviderId === provider.id) {
                form.setFieldValue("enabled", enabled);
            }
        } catch (error) {
            setProviders((current) => current.map((item) => (item.id === provider.id ? { ...item, enabled: previousEnabled ? 1 : 0 } : item)));
            message.error(error instanceof Error ? error.message : copy.messages.toggleError);
        } finally {
            setUpdatingProviderIds((current) => current.filter((id) => id !== provider.id));
            await load();
        }
    };

    const beginEdit = (provider: StudioProvider) => {
        setEditingProviderId(provider.id);
        form.setFieldsValue(providerToFormValues(provider));
    };

    const handleDelete = async (provider: StudioProvider) => {
        try {
            setUpdatingProviderIds((current) => [...current, provider.id]);
            await deleteStudioProvider(provider.id);
            if (editingProviderId === provider.id) resetProviderForm();
            message.success(copy.messages.deleteSuccess);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.deleteError);
        } finally {
            setUpdatingProviderIds((current) => current.filter((id) => id !== provider.id));
        }
    };

    return (
        <div className="grid gap-4 xl:grid-cols-[460px_1fr]">
            <Card title={editingProviderId ? copy.editTitle : copy.createTitle} extra={editingProviderId ? <Button onClick={resetProviderForm}>{copy.cancel}</Button> : null}>
                <Form form={form} layout="vertical" requiredMark={false} initialValues={initialProviderValues} onFinish={handleSubmit}>
                    <Form.Item name="name" label={copy.providerName} rules={[{ required: true, whitespace: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="baseUrl" label={copy.baseUrl} rules={[{ required: true, whitespace: true }]}>
                        <Input placeholder="https://example.com" />
                    </Form.Item>
                    <Form.Item name="apiKey" label={editingProviderId ? copy.apiKeyEdit : copy.apiKey} rules={editingProviderId ? undefined : [{ required: true, whitespace: true }]}>
                        <Input.Password />
                    </Form.Item>
                    <Form.Item name="apiFormat" label={copy.requestFormat}>
                        <Select options={API_FORMAT_OPTIONS} onChange={(value: ApiCallFormat) => applyRecommendedDefaults(value)} />
                    </Form.Item>
                    <Form.Item name="enabled" label={copy.enabled} valuePropName="checked">
                        <Switch />
                    </Form.Item>

                    <Collapse
                        className="mb-4"
                        items={[
                            {
                                key: "advanced",
                                label: copy.advanced,
                                children: (
                                    <div className="grid gap-3">
                                        <Form.Item name="protocolTemplate" label={copy.protocolTemplate}>
                                            <Select
                                                options={[
                                                    { label: copy.protocolOptions.openai, value: "openai" },
                                                    { label: copy.protocolOptions.gemini, value: "gemini" },
                                                    { label: copy.protocolOptions.agnes, value: "agnes" },
                                                    { label: copy.protocolOptions.openai_async, value: "openai_async" },
                                                    { label: copy.protocolOptions.generic_async, value: "generic_async" },
                                                ]}
                                            />
                                        </Form.Item>
                                        <Form.Item name="isAsync" label={copy.isAsync} valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                        <Form.Item name="createPath" label={copy.createPath}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item name="pollPathTemplate" label={copy.pollPathTemplate}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item name="contentPathTemplate" label={copy.contentPathTemplate}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item name="taskIdField" label={copy.taskIdField}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item name="statusField" label={copy.statusField}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item name="resultUrlField" label={copy.resultUrlField}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item name="completedStatusesText" label={copy.completedStatuses}>
                                            <Input.TextArea rows={2} placeholder={copy.completedPlaceholder} />
                                        </Form.Item>
                                        <Form.Item name="failedStatusesText" label={copy.failedStatuses}>
                                            <Input.TextArea rows={2} placeholder={copy.failedPlaceholder} />
                                        </Form.Item>
                                        <Form.Item name="downloadResult" label={copy.downloadResult} valuePropName="checked">
                                            <Switch />
                                        </Form.Item>
                                        <Form.Item name="authMode" label={copy.authMode}>
                                            <Select
                                                options={[
                                                    { label: copy.authOptions.bearer, value: "bearer" },
                                                    { label: copy.authOptions.header, value: "header" },
                                                    { label: copy.authOptions.query, value: "query" },
                                                ]}
                                            />
                                        </Form.Item>
                                        <Form.Item name="authHeaderName" label={copy.authHeaderName}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item name="authQueryName" label={copy.authQueryName}>
                                            <Input />
                                        </Form.Item>
                                        <Form.Item
                                            name="extraHeadersText"
                                            label={copy.extraHeaders}
                                            rules={[
                                                {
                                                    validator: async (_, value: string | undefined) => {
                                                        if (!value?.trim()) {
                                                            return;
                                                        }
                                                        const parsed = JSON.parse(value) as unknown;
                                                        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
                                                            throw new Error(copy.messages.invalidHeaders);
                                                        }
                                                    },
                                                },
                                            ]}
                                        >
                                            <Input.TextArea rows={6} placeholder={copy.extraHeadersPlaceholder} />
                                        </Form.Item>
                                    </div>
                                ),
                            },
                        ]}
                    />

                    <Space className="w-full" direction="vertical" size="small">
                        <Button type="primary" htmlType="submit" block loading={saving}>
                            {editingProviderId ? copy.save : copy.create}
                        </Button>
                        <Button block onClick={resetProviderForm}>
                            {copy.reset}
                        </Button>
                    </Space>
                </Form>
            </Card>

            <Card title={copy.listTitle}>
                <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={providers}
                    pagination={false}
                    scroll={{ x: true }}
                    columns={[
                        { title: copy.columns.name, dataIndex: "name" },
                        { title: copy.columns.baseUrl, dataIndex: "base_url" },
                        { title: copy.columns.format, dataIndex: "api_format" },
                        {
                            title: copy.columns.mode,
                            render: (_, item) => (Boolean(item.is_async) ? <Tag color="blue">{copy.modeAsync}</Tag> : <Tag>{copy.modeSync}</Tag>),
                        },
                        {
                            title: copy.columns.enabled,
                            render: (_, item) => <Switch checked={Boolean(item.enabled)} loading={updatingProviderIds.includes(item.id)} onChange={(enabled) => void handleToggleEnabled(item, enabled)} />,
                        },
                        {
                            title: copy.columns.actions,
                            render: (_, item) => (
                                <Space>
                                    <Button size="small" onClick={() => beginEdit(item)}>
                                        {copy.edit}
                                    </Button>
                                    <Popconfirm title={copy.deleteConfirm} okText={copy.delete} cancelText={copy.cancel} onConfirm={() => void handleDelete(item)}>
                                        <Button size="small" danger loading={updatingProviderIds.includes(item.id)}>
                                            {copy.delete}
                                        </Button>
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    );
}

function ModelsTab({ locale }: { locale: StudioLocale }) {
    const { message } = App.useApp();
    const copy = ADMIN_COPY[locale].models;
    const [providers, setProviders] = useState<StudioProvider[]>([]);
    const [models, setModels] = useState<StudioModel[]>([]);
    const [loading, setLoading] = useState(false);
    const [modelCreditDrafts, setModelCreditDrafts] = useState<Record<string, number>>({});
    const [modelPricingDrafts, setModelPricingDrafts] = useState<Record<string, StudioPricingRules>>({});
    const [updatingModelKeys, setUpdatingModelKeys] = useState<string[]>([]);
    const [editingModelId, setEditingModelId] = useState<number | null>(null);
    const [form] = Form.useForm();

    const modelKeyFor = (item: StudioModel) => String(item.rowId || item.model);

    const load = async () => {
        setLoading(true);
        try {
            const [nextProviders, nextModels] = await Promise.all([fetchStudioProviders(), fetchStudioAdminModels()]);
            setProviders(nextProviders);
            setModels(nextModels);
            setModelCreditDrafts(Object.fromEntries(nextModels.map((item) => [modelKeyFor(item), Number(item.creditCost || 0)])));
            setModelPricingDrafts(Object.fromEntries(nextModels.map((item) => [modelKeyFor(item), normalizePricingRules(item.capability, item.pricingRules, Number(item.creditCost || 0))])));
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.loadError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const resetModelForm = () => {
        setEditingModelId(null);
        form.resetFields();
        form.setFieldsValue({ capability: "image", creditCost: 0, enabled: true });
    };

    const submitModel = async (values: { providerId: number; model: string; displayName?: string; capability: ModelCapability; creditCost?: number; enabled?: boolean }) => {
        try {
            const payload = {
                providerId: values.providerId,
                model: values.model.trim(),
                displayName: values.displayName?.trim() || values.model.trim(),
                capability: values.capability,
                creditCost: Number(values.creditCost || 0),
                pricingRules: defaultPricingRules(values.capability, Number(values.creditCost || 0)),
                enabled: values.enabled !== false,
            };
            if (editingModelId) {
                await updateStudioModel(editingModelId, payload);
                message.success(copy.messages.updateSuccess);
            } else {
                await createStudioModel(payload);
                message.success(copy.messages.createSuccess);
            }
            resetModelForm();
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.createError);
        }
    };

    const beginModelEdit = (item: StudioModel) => {
        if (!item.rowId) return;
        setEditingModelId(item.rowId);
        form.setFieldsValue({
            providerId: item.providerId,
            model: item.model,
            displayName: item.displayName,
            capability: item.capability,
            creditCost: Number(item.creditCost || 0),
            pricingRules: normalizePricingRules(item.capability, item.pricingRules, Number(item.creditCost || 0)),
            enabled: item.enabled,
        });
    };

    const deleteModel = async (item: StudioModel) => {
        if (!item.rowId) return;
        const key = modelKeyFor(item);
        try {
            setUpdatingModelKeys((current) => [...current, key]);
            await deleteStudioModel(item.rowId);
            if (editingModelId === item.rowId) resetModelForm();
            message.success(copy.messages.deleteSuccess);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.deleteError);
        } finally {
            setUpdatingModelKeys((current) => current.filter((currentKey) => currentKey !== key));
        }
    };

    const updateModelCredit = async (item: StudioModel) => {
        if (!item.rowId) {
            return;
        }
        const key = modelKeyFor(item);
        const nextCreditCost = Number(modelCreditDrafts[key] ?? item.creditCost ?? 0);
        const previousCreditCost = Number(item.creditCost || 0);
        if (nextCreditCost === previousCreditCost) {
            return;
        }

        setModels((current) => current.map((model) => (modelKeyFor(model) === key ? { ...model, creditCost: nextCreditCost } : model)));
        setUpdatingModelKeys((current) => [...current, key]);
        try {
            await updateStudioModel(item.rowId, { creditCost: nextCreditCost });
            await load();
        } catch (error) {
            setModels((current) => current.map((model) => (modelKeyFor(model) === key ? { ...model, creditCost: previousCreditCost } : model)));
            setModelCreditDrafts((current) => ({ ...current, [key]: previousCreditCost }));
            message.error(error instanceof Error ? error.message : copy.messages.updateCreditError);
        } finally {
            setUpdatingModelKeys((current) => current.filter((currentKey) => currentKey !== key));
        }
    };

    const toggleModelEnabled = async (item: StudioModel, enabled: boolean) => {
        if (!item.rowId) {
            return;
        }
        const key = modelKeyFor(item);
        const previousEnabled = item.enabled;
        setModels((current) => current.map((model) => (modelKeyFor(model) === key ? { ...model, enabled } : model)));
        setUpdatingModelKeys((current) => [...current, key]);
        try {
            await updateStudioModel(item.rowId, { enabled });
            await load();
        } catch (error) {
            setModels((current) => current.map((model) => (modelKeyFor(model) === key ? { ...model, enabled: previousEnabled } : model)));
            message.error(error instanceof Error ? error.message : copy.messages.updateStatusError);
        } finally {
            setUpdatingModelKeys((current) => current.filter((currentKey) => currentKey !== key));
        }
    };

    const patchPricingDraft = (item: StudioModel, path: string[], patch: Partial<PricingEntry>) => {
        const key = modelKeyFor(item);
        setModelPricingDrafts((current) => {
            const nextRules = normalizePricingRules(item.capability, current[key] || item.pricingRules, Number(modelCreditDrafts[key] ?? item.creditCost ?? 0));
            const [capability, group, option] = path as [keyof StudioPricingRules, string, string];
            const capabilityRules = { ...((nextRules[capability] as Record<string, unknown>) || {}) };
            const groupRules = { ...((capabilityRules[group] as Record<string, PricingEntry>) || {}) };
            groupRules[option] = { ...(groupRules[option] || { enabled: true, credits: 0 }), ...patch };
            capabilityRules[group] = groupRules;
            return { ...current, [key]: { ...nextRules, [capability]: capabilityRules } as StudioPricingRules };
        });
    };

    const savePricingDraft = async (item: StudioModel) => {
        if (!item.rowId) return;
        const key = modelKeyFor(item);
        const nextRules = normalizePricingRules(item.capability, modelPricingDrafts[key] || item.pricingRules, Number(modelCreditDrafts[key] ?? item.creditCost ?? 0));
        setUpdatingModelKeys((current) => [...current, key]);
        try {
            await updateStudioModel(item.rowId, { pricingRules: nextRules });
            message.success(copy.messages.updateSuccess);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.updateCreditError);
        } finally {
            setUpdatingModelKeys((current) => current.filter((currentKey) => currentKey !== key));
        }
    };

    return (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <Card title={editingModelId ? copy.editTitle : copy.createTitle} extra={editingModelId ? <Button onClick={resetModelForm}>{copy.cancel}</Button> : null}>
                <Form form={form} layout="vertical" requiredMark={false} initialValues={{ capability: "image", creditCost: 0, enabled: true }} onFinish={submitModel}>
                    <Form.Item name="providerId" label={copy.provider} rules={[{ required: true }]}>
                        <Select options={providers.map((provider) => ({ label: provider.name, value: provider.id }))} />
                    </Form.Item>
                    <Form.Item name="model" label={copy.modelId} rules={[{ required: true }]}>
                        <Input placeholder="agnes-image-2.1-flash" />
                    </Form.Item>
                    <Form.Item name="displayName" label={copy.displayName}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="capability" label={copy.capability}>
                        <Select options={capabilityOptions.map((option) => ({ ...option, label: locale === "zh" ? ({ text: "文本", image: "图片", video: "视频", audio: "音频" }[option.value]) : option.label }))} />
                    </Form.Item>
                    <Form.Item name="creditCost" label={copy.creditCost}>
                        <InputNumber className="w-full" min={0} step={1} />
                    </Form.Item>
                    <Form.Item name="enabled" label={copy.enabled} valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Space className="w-full" direction="vertical" size="small">
                        <Button type="primary" htmlType="submit" block>
                            {editingModelId ? copy.save : copy.create}
                        </Button>
                        <Button block onClick={resetModelForm}>
                            {editingModelId ? copy.cancel : "Reset"}
                        </Button>
                    </Space>
                </Form>
            </Card>
            <Card title={copy.catalogTitle}>
                <Table
                    rowKey={modelKeyFor}
                    loading={loading}
                    dataSource={models}
                    scroll={{ x: true }}
                    expandable={{
                        expandedRowRender: (item) => (
                            <ModelPricingEditor
                                item={item}
                                rules={modelPricingDrafts[modelKeyFor(item)] || normalizePricingRules(item.capability, item.pricingRules, Number(item.creditCost || 0))}
                                disabled={!item.rowId || updatingModelKeys.includes(modelKeyFor(item))}
                                onPatch={(path, patch) => patchPricingDraft(item, path, patch)}
                                onSave={() => void savePricingDraft(item)}
                            />
                        ),
                    }}
                    columns={[
                        { title: copy.columns.model, dataIndex: "model" },
                        { title: copy.columns.displayName, dataIndex: "displayName" },
                        { title: copy.columns.provider, dataIndex: "provider" },
                        { title: copy.columns.capability, dataIndex: "capability", render: (value) => <Tag>{locale === "zh" ? ({ text: "文本", image: "图片", video: "视频", audio: "音频" }[value as ModelCapability] || value) : value}</Tag> },
                        {
                            title: copy.columns.credits,
                            render: (_, item) => (
                                <InputNumber
                                    min={0}
                                    className="w-full"
                                    value={modelCreditDrafts[modelKeyFor(item)] ?? Number(item.creditCost || 0)}
                                    disabled={!item.rowId || updatingModelKeys.includes(modelKeyFor(item))}
                                    onChange={(value) => {
                                        const nextValue = Number(value || 0);
                                        setModelCreditDrafts((current) => ({ ...current, [modelKeyFor(item)]: nextValue }));
                                    }}
                                    onBlur={() => void updateModelCredit(item)}
                                />
                            ),
                        },
                        {
                            title: copy.columns.enabled,
                            render: (_, item) => (
                                <Switch
                                    checked={item.enabled}
                                    disabled={!item.rowId}
                                    loading={updatingModelKeys.includes(modelKeyFor(item))}
                                    onChange={(enabled) => void toggleModelEnabled(item, enabled)}
                                />
                            ),
                        },
                        {
                            title: copy.columns.actions,
                            render: (_, item) => (
                                <Space>
                                    <Button size="small" disabled={!item.rowId} onClick={() => beginModelEdit(item)}>
                                        {copy.edit}
                                    </Button>
                                    <Popconfirm title={copy.deleteConfirm} okText={copy.delete} cancelText={copy.cancel} onConfirm={() => void deleteModel(item)}>
                                        <Button size="small" danger disabled={!item.rowId} loading={updatingModelKeys.includes(modelKeyFor(item))}>
                                            {copy.delete}
                                        </Button>
                                    </Popconfirm>
                                </Space>
                            ),
                        },
                    ]}
                />
            </Card>
        </div>
    );
}

function ModelPricingEditor({
    item,
    rules,
    disabled,
    onPatch,
    onSave,
}: {
    item: StudioModel;
    rules: StudioPricingRules;
    disabled: boolean;
    onPatch: (path: string[], patch: Partial<PricingEntry>) => void;
    onSave: () => void;
}) {
    if (item.capability !== "image" && item.capability !== "video") {
        return <div className="rounded-xl bg-stone-50 p-4 text-sm text-stone-500">文本和音频模型使用上方统一积分；图片/视频模型可在这里配置不同规格积分。</div>;
    }
    return (
        <div className="grid gap-4 rounded-xl bg-stone-50 p-4 md:grid-cols-2">
            {item.capability === "image" ? (
                <>
                    <PricingGroup
                        title="图片质量积分"
                        hint="用户选择“自动”时按“中”质量扣费。"
                        items={imageQualityItems}
                        entries={rules.image?.quality || {}}
                        disabled={disabled}
                        onPatch={(option, patch) => onPatch(["image", "quality", option], patch)}
                    />
                    <PricingGroup
                        title="图片尺寸积分"
                        hint="用户选择 auto 时按 2K 扣费；最终图片单价 = 质量积分 + 尺寸积分。"
                        items={imageSizeTierItems}
                        entries={rules.image?.size || {}}
                        disabled={disabled}
                        onPatch={(option, patch) => onPatch(["image", "size", option], patch)}
                    />
                </>
            ) : (
                <div className="md:col-span-2">
                    <PricingGroup
                        title="视频清晰度每秒积分"
                        hint="视频最终扣费 = 清晰度每秒积分 × 生成秒数。"
                        items={videoResolutionItems}
                        entries={rules.video?.resolution || {}}
                        disabled={disabled}
                        onPatch={(option, patch) => onPatch(["video", "resolution", option], patch)}
                    />
                </div>
            )}
            <div className="md:col-span-2">
                <Button type="primary" disabled={disabled} onClick={onSave}>
                    保存规格积分
                </Button>
            </div>
        </div>
    );
}

function PricingGroup<T extends string>({
    title,
    hint,
    items,
    entries,
    disabled,
    onPatch,
}: {
    title: string;
    hint: string;
    items: readonly { value: T; label: string }[];
    entries: Partial<Record<T, PricingEntry>>;
    disabled: boolean;
    onPatch: (option: T, patch: Partial<PricingEntry>) => void;
}) {
    return (
        <Card size="small" title={title}>
            <div className="mb-3 text-xs text-stone-500">{hint}</div>
            <div className="grid gap-2">
                {items.map((item) => {
                    const entry = entries[item.value] || { enabled: true, credits: 0 };
                    return (
                        <div key={item.value} className="grid grid-cols-[80px_1fr_96px] items-center gap-3">
                            <Tag>{item.label}</Tag>
                            <InputNumber className="w-full" min={0} step={0.01} value={Number(entry.credits || 0)} disabled={disabled || entry.enabled === false} onChange={(value) => onPatch(item.value, { credits: Number(value || 0) })} />
                            <Switch checked={entry.enabled !== false} disabled={disabled} checkedChildren="启用" unCheckedChildren="关闭" onChange={(enabled) => onPatch(item.value, { enabled })} />
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

function UsageTab({ locale }: { locale: StudioLocale }) {
    const { message } = App.useApp();
    const copy = ADMIN_COPY[locale].usage;
    const [usage, setUsage] = useState<StudioUsage[]>([]);
    const [loading, setLoading] = useState(false);
    const [resolvingReport, setResolvingReport] = useState<string>("");
    const [refundingUsage, setRefundingUsage] = useState<string>("");
    const [filters, setFilters] = useState({ source: "", user: "", model: "", capability: "", range: [undefined, undefined] as [number | undefined, number | undefined] });

    const load = async (nextFilters = filters) => {
        setLoading(true);
        try {
            setUsage(
                await fetchStudioUsage({
                    source: nextFilters.source || undefined,
                    user: nextFilters.user || undefined,
                    model: nextFilters.model || undefined,
                    capability: nextFilters.capability || undefined,
                    from: nextFilters.range[0],
                    to: nextFilters.range[1],
                    limit: 500,
                }),
            );
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.loadError);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const modelOptions = useMemo(() => Array.from(new Set(usage.map((item) => item.model))).map((value) => ({ value, label: value })), [usage]);
    const reset = () => {
        const next = { source: "", user: "", model: "", capability: "", range: [undefined, undefined] as [undefined, undefined] };
        setFilters(next);
        void load(next);
    };
    const resolveReport = async (item: StudioUsage) => {
        setResolvingReport(item.external_key);
        try {
            await updateStudioUsageReport(item.external_key, "resolved");
            message.success(locale === "zh" ? "已标记为处理完成" : "Marked as resolved");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.loadError);
        } finally {
            setResolvingReport("");
        }
    };
    const refundUsage = async (item: StudioUsage) => {
        setRefundingUsage(item.external_key);
        try {
            const credits = await refundStudioUsage(item.external_key);
            message.success(locale === "zh" ? `已返还 ${formatNumber(credits)} 积分` : `Refunded ${formatNumber(credits)} credits`);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : copy.messages.loadError);
        } finally {
            setRefundingUsage("");
        }
    };

    return (
        <Card
            title={copy.title}
            extra={
                <Space>
                    <Button onClick={() => void load()}>{copy.refresh}</Button>
                </Space>
            }
        >
            <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[130px_1fr_1.2fr_1fr_1.5fr_auto]">
                <Select allowClear placeholder={locale === "zh" ? "来源" : "Source"} value={filters.source || undefined} options={[{ value: "massmore", label: "MassMore" }, { value: "mtline", label: "Mtline" }, { value: "studio", label: "Studio" }]} onChange={(source) => setFilters((current) => ({ ...current, source: source || "" }))} />
                <Input allowClear placeholder={locale === "zh" ? "用户名或邮箱" : "User or email"} value={filters.user} onChange={(event) => setFilters((current) => ({ ...current, user: event.target.value }))} onPressEnter={() => void load()} />
                <Select allowClear showSearch optionFilterProp="label" placeholder={locale === "zh" ? "模型" : "Model"} value={filters.model || undefined} options={modelOptions} onChange={(model) => setFilters((current) => ({ ...current, model: model || "" }))} />
                <Select allowClear placeholder={locale === "zh" ? "能力" : "Capability"} value={filters.capability || undefined} options={[{ value: "text", label: locale === "zh" ? "文字" : "Text" }, { value: "image", label: locale === "zh" ? "图片" : "Image" }, { value: "video", label: locale === "zh" ? "视频" : "Video" }, { value: "audio", label: locale === "zh" ? "音频" : "Audio" }]} onChange={(capability) => setFilters((current) => ({ ...current, capability: capability || "" }))} />
                <DatePicker.RangePicker className="w-full" showTime onChange={(range) => setFilters((current) => ({ ...current, range: [range?.[0]?.unix(), range?.[1]?.unix()] }))} />
                <Space>
                    <Button type="primary" onClick={() => void load()}>{locale === "zh" ? "筛选" : "Filter"}</Button>
                    <Button onClick={reset}>{locale === "zh" ? "重置" : "Reset"}</Button>
                </Space>
            </div>
            <Table
                rowKey="id"
                loading={loading}
                dataSource={usage}
                size="middle"
                pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => (locale === "zh" ? `共 ${total} 条` : `${total} records`) }}
                scroll={{ x: 1160 }}
                columns={[
                    { title: copy.columns.time, dataIndex: "created_at", width: 164, render: (value: number) => new Date(value * 1000).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") },
                    { title: copy.columns.source, dataIndex: "source", width: 86 },
                    { title: copy.columns.user, width: 140, ellipsis: true, render: (_, item) => item.username || item.email || item.user_id },
                    { title: copy.columns.model, dataIndex: "model", width: 166, ellipsis: true },
                    { title: copy.columns.capability, dataIndex: "capability", width: 82, render: (value: string) => <Tag>{value}</Tag> },
                    { title: copy.columns.quantity, width: 104, render: (_, item) => formatUsageQuantity(item, locale) },
                    { title: copy.columns.credits, dataIndex: "credits", width: 90, render: (value: number) => formatNumber(value) },
                    { title: copy.columns.elapsed, dataIndex: "elapsed_ms", width: 82, render: (value: number) => formatElapsed(value) },
                    { title: copy.columns.balanceDelta, dataIndex: "balance_delta", width: 106, render: (value: number) => formatNumber(value) },
                    { title: copy.columns.status, dataIndex: "status", width: 106, render: (value: string) => <Tag color={value === "success" ? "green" : value.includes("refund") ? "orange" : "blue"}>{value}</Tag> },
                    {
                        title: copy.columns.error,
                        width: 360,
                        ellipsis: { showTitle: false },
                        render: (_, item) => {
                            const detail = [item.error, item.report_note ? `${locale === "zh" ? "用户备注" : "User note"}: ${item.report_note}` : ""].filter(Boolean).join("\n");
                            const canRefund = item.report_status === "open" && ["massmore", "mtline"].includes(item.source) && Number(item.credits || 0) > 0 && item.admin_refund_status !== "processing" && item.admin_refund_status !== "completed";
                            return detail || item.report_status ? <div className="flex min-w-0 items-center gap-1"><Tooltip title={detail || undefined}><span className="min-w-0 flex-1 truncate">{item.admin_refund_status === "completed" ? <Tag color="green">{locale === "zh" ? `已返还 ${formatNumber(item.admin_refund_credits)} 积分` : `Refunded ${formatNumber(item.admin_refund_credits)}`}</Tag> : item.report_status === "open" ? <Tag color="orange">{locale === "zh" ? "待处理" : "Open"}</Tag> : item.report_status === "resolved" ? <Tag color="green">{locale === "zh" ? "已处理" : "Resolved"}</Tag> : null}{detail}</span></Tooltip>{canRefund ? <Popconfirm title={locale === "zh" ? `确认返还本次实际扣除的 ${formatNumber(item.credits)} 积分？` : `Refund ${formatNumber(item.credits)} credits for this usage?`} okText={locale === "zh" ? "确认返还" : "Refund"} cancelText={locale === "zh" ? "取消" : "Cancel"} onConfirm={() => void refundUsage(item)}><Button size="small" type="primary" loading={refundingUsage === item.external_key}>{locale === "zh" ? "返还积分" : "Refund"}</Button></Popconfirm> : null}{item.report_status === "open" ? <Button size="small" loading={resolvingReport === item.external_key} onClick={() => void resolveReport(item)}>{locale === "zh" ? "完成" : "Resolve"}</Button> : null}</div> : "-";
                        },
                    },
                ]}
            />
        </Card>
    );
}

function formatUsageQuantity(item: StudioUsage, locale: StudioLocale) {
    const unitCount = Number(item.unit_count || 1);
    const successCount = Number(item.success_count || 0);
    const failedCount = Number(item.failed_count || 0);
    const unit =
        item.capability === "image"
            ? locale === "zh"
                ? "张"
                : "images"
            : item.capability === "video"
              ? locale === "zh"
                  ? "秒"
                  : "sec"
              : locale === "zh"
                ? "次"
                : "calls";
    const base = `${unitCount} ${unit}`;
    if (!successCount && !failedCount) return base;
    return `${base} / ${locale === "zh" ? "成功" : "ok"} ${successCount}, ${locale === "zh" ? "失败" : "failed"} ${failedCount}`;
}

function formatElapsed(value?: number) {
    const ms = Number(value || 0);
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(value?: number) {
    const num = Number(value || 0);
    return Number.isInteger(num) ? String(num) : num.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
