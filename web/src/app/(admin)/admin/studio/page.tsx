"use client";

import { App, Button, Card, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
    createStudioModel,
    createStudioProvider,
    deleteStudioModel,
    deleteStudioProvider,
    discoverStudioProviderModels,
    fetchStudioAdminModels,
    fetchStudioAccounts,
    fetchStudioConcurrency,
    fetchStudioPricingSettings,
    fetchStudioProviders,
    fetchStudioUsage,
    fetchStudioWorkflowUsers,
    fetchStudioWorkflows,
    isStudioManagedHost,
    testStudioModel,
    testStudioProvider,
    updateStudioConcurrencySettings,
    updateStudioPricingSettings,
    updateStudioModel,
    updateStudioModelFailover,
    updateStudioProvider,
    updateStudioUserConcurrency,
    resetStudioUserConcurrency,
    updateStudioWorkflow,
    type StudioAccount,
    type StudioModel,
    type StudioPricingSettings,
    type StudioProvider,
    type StudioUsage,
    type StudioWorkflow,
} from "@/services/studio-managed";

type ProviderFormValues = { name: string; baseUrl: string; apiKey?: string; apiFormat: string; protocolTemplate?: string; isAsync?: boolean; enabled: boolean };
type ModelFormValues = { providerId: number; model: string; displayName: string; capability: "text" | "image" | "video" | "audio"; creditCost: number; enabled: boolean };

const capabilityOptions = [
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

export default function StudioAdminPage() {
    return <Suspense fallback={null}><StudioAdminContent /></Suspense>;
}

function StudioAdminContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { message } = App.useApp();
    const [providers, setProviders] = useState<StudioProvider[]>([]);
    const [models, setModels] = useState<StudioModel[]>([]);
    const [usage, setUsage] = useState<StudioUsage[]>([]);
    const [accounts, setAccounts] = useState<StudioAccount[]>([]);
    const [workflows, setWorkflows] = useState<StudioWorkflow[]>([]);
    const [workflowUsers, setWorkflowUsers] = useState<Array<{ value: string; label: string }>>([]);
    const [pricing, setPricing] = useState<StudioPricingSettings | null>(null);
    const [concurrencyUsers, setConcurrencyUsers] = useState<NonNullable<Awaited<ReturnType<typeof fetchStudioConcurrency>>["users"]>>([]);
    const [loading, setLoading] = useState(true);
    const [providerForm] = Form.useForm<ProviderFormValues>();
    const [modelForm] = Form.useForm<ModelFormValues>();
    const [editingProvider, setEditingProvider] = useState<number | null>(null);
    const [editingModel, setEditingModel] = useState<number | null>(null);
    const [discovered, setDiscovered] = useState<Array<{ id: string; displayName: string }>>([]);
    const [failoverModel, setFailoverModel] = useState<StudioModel | null>(null);
    const [failoverEnabled, setFailoverEnabled] = useState(false);
    const [failoverRoutes, setFailoverRoutes] = useState<number[]>([]);
    const [globalLimit, setGlobalLimit] = useState(0);
    const [defaultLimit, setDefaultLimit] = useState(1);
    const [runningTotal, setRunningTotal] = useState(0);
    const [queuedTotal, setQueuedTotal] = useState(0);

    const refresh = async () => {
        setLoading(true);
        try {
            const [nextProviders, nextModels, nextUsage, concurrency, nextWorkflows, nextWorkflowUsers, nextAccounts, nextPricing] = await Promise.all([
                fetchStudioProviders(), fetchStudioAdminModels(), fetchStudioUsage(), fetchStudioConcurrency(), fetchStudioWorkflows(), fetchStudioWorkflowUsers(), fetchStudioAccounts(), fetchStudioPricingSettings(),
            ]);
            setProviders(nextProviders);
            setModels(nextModels);
            setUsage(nextUsage);
            setGlobalLimit(concurrency.globalLimit);
            setDefaultLimit(concurrency.defaultLimit);
            setRunningTotal(concurrency.runningTotal);
            setQueuedTotal(concurrency.queuedTotal);
            setConcurrencyUsers(concurrency.users || []);
            setWorkflows(nextWorkflows);
            setWorkflowUsers(nextWorkflowUsers);
            setAccounts(nextAccounts);
            setPricing(nextPricing);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "加载 Studio 管理数据失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isStudioManagedHost()) {
            router.replace("/admin/users");
            return;
        }
        void refresh();
    // The page is host-scoped; only initialize it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const providerSubmit = async (values: ProviderFormValues) => {
        try {
            const payload = { ...values, protocolTemplate: values.protocolTemplate || undefined };
            if (editingProvider) await updateStudioProvider(editingProvider, payload);
            else await createStudioProvider(payload);
            providerForm.resetFields();
            setEditingProvider(null);
            message.success("供应商已保存");
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存供应商失败");
        }
    };

    const modelSubmit = async (values: ModelFormValues) => {
        try {
            if (editingModel) await updateStudioModel(editingModel, values);
            else await createStudioModel(values);
            modelForm.resetFields();
            setEditingModel(null);
            setDiscovered([]);
            message.success("模型已保存");
            await refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型失败");
        }
    };

    const beginProviderEdit = (provider: StudioProvider) => {
        setEditingProvider(provider.id);
        providerForm.setFieldsValue({ name: provider.name, baseUrl: provider.base_url, apiFormat: provider.api_format, protocolTemplate: provider.protocol_template, isAsync: Boolean(provider.is_async), enabled: Boolean(provider.enabled) });
    };
    const beginModelEdit = (model: StudioModel) => {
        setEditingModel(Number(model.rowId || model.id));
        modelForm.setFieldsValue({ providerId: Number(model.providerId), model: model.model, displayName: model.displayName, capability: model.capability, creditCost: model.creditCost, enabled: model.enabled });
    };
    const openFailover = (model: StudioModel) => {
        setFailoverModel(model);
        setFailoverEnabled(Boolean(model.failoverEnabled));
        setFailoverRoutes(model.failoverRouteModelIds || []);
    };

    const providerColumns = [
        { title: "名称", dataIndex: "name" },
        { title: "Base URL", dataIndex: "base_url", ellipsis: true },
        { title: "协议", dataIndex: "protocol_template", render: (value: string, row: StudioProvider) => <Tag>{value || row.api_format || "openai"}</Tag> },
        { title: "启用", render: (_: unknown, row: StudioProvider) => <Switch checked={Boolean(row.enabled)} onChange={(enabled) => void updateStudioProvider(row.id, { enabled }).then(refresh).catch((error: unknown) => message.error(error instanceof Error ? error.message : "更新失败"))} /> },
        {
            title: "操作",
            render: (_: unknown, row: StudioProvider) => <Space size={4}>
                <Button type="link" size="small" onClick={() => void testStudioProvider(row.id).then((result) => result.ok ? message.success(result.message) : message.error(result.message)).catch((error: unknown) => message.error(error instanceof Error ? error.message : "测链失败"))}>测链</Button>
                <Button type="link" size="small" onClick={() => beginProviderEdit(row)}>编辑</Button>
                <Popconfirm title="删除供应商及其模型？" onConfirm={() => void deleteStudioProvider(row.id).then(refresh).catch((error: unknown) => message.error(error instanceof Error ? error.message : "删除失败"))}><Button danger type="link" size="small">删除</Button></Popconfirm>
            </Space>,
        },
    ];
    const modelColumns = [
        { title: "模型 ID", dataIndex: "model", ellipsis: true },
        { title: "显示名称", dataIndex: "displayName" },
        { title: "供应商", dataIndex: "provider" },
        { title: "能力", dataIndex: "capability", render: (value: string) => <Tag>{capabilityOptions.find((item) => item.value === value)?.label || value}</Tag> },
        { title: "积分", dataIndex: "creditCost" },
        { title: "启用", render: (_: unknown, row: StudioModel) => <Switch checked={row.enabled} onChange={(enabled) => void updateStudioModel(Number(row.rowId || row.id), { enabled }).then(refresh).catch((error: unknown) => message.error(error instanceof Error ? error.message : "更新失败"))} /> },
        {
            title: "操作",
            render: (_: unknown, row: StudioModel) => <Space size={2} wrap>
                <Button type="link" size="small" onClick={() => void testStudioModel(Number(row.rowId || row.id)).then((result) => result.ok ? message.success(result.message) : message.error(result.message)).catch((error: unknown) => message.error(error instanceof Error ? error.message : "测试失败"))}>测试</Button>
                <Button type="link" size="small" onClick={() => openFailover(row)}>轮询</Button>
                <Button type="link" size="small" onClick={() => beginModelEdit(row)}>编辑</Button>
                <Popconfirm title="删除模型？" onConfirm={() => void deleteStudioModel(Number(row.rowId || row.id)).then(refresh).catch((error: unknown) => message.error(error instanceof Error ? error.message : "删除失败"))}><Button danger type="link" size="small">删除</Button></Popconfirm>
            </Space>,
        },
    ];

    return (
        <div className="mx-auto w-full max-w-[1480px] p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div><Typography.Title level={3} className="!mb-1">Studio 管理后台</Typography.Title><Typography.Text type="secondary">供应商、模型、积分、轮询、并发和使用记录。</Typography.Text></div>
                <Button onClick={() => void refresh()} loading={loading}>刷新</Button>
            </div>
            <Tabs
                activeKey={searchParams.get("tab") || "providers"}
                onChange={(key) => router.replace(`/admin/studio?tab=${key}`)}
                items={[
                    {
                        key: "providers",
                        label: "供应商",
                        children: <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                            <Card size="small" title={editingProvider ? "编辑供应商" : "新增供应商"}>
                                <Form form={providerForm} layout="vertical" initialValues={{ apiFormat: "openai", enabled: true }} onFinish={providerSubmit}>
                                    <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
                                    <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, type: "url" }]}><Input /></Form.Item>
                                    <Form.Item name="apiKey" label={editingProvider ? "API Key（留空不修改）" : "API Key"} rules={editingProvider ? [] : [{ required: true }]}><Input.Password /></Form.Item>
                                    <Form.Item name="apiFormat" label="请求格式" rules={[{ required: true }]}><Select options={[{ value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Gemini" }, { value: "grok", label: "Grok2API" }]} /></Form.Item>
                                    <Form.Item name="protocolTemplate" label="协议模板"><Select allowClear options={[{ value: "openai", label: "OpenAI" }, { value: "grok2api", label: "Grok2API" }, { value: "agnes", label: "AGNES" }, { value: "generic_async", label: "通用异步" }]} /></Form.Item>
                                    <Form.Item name="isAsync" label="异步任务" valuePropName="checked"><Switch /></Form.Item>
                                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                                    <Space><Button type="primary" htmlType="submit">保存</Button><Button onClick={() => { setEditingProvider(null); providerForm.resetFields(); }}>重置</Button></Space>
                                </Form>
                            </Card>
                            <Table rowKey="id" loading={loading} columns={providerColumns} dataSource={providers} scroll={{ x: 760 }} pagination={{ pageSize: 10 }} />
                        </div>,
                    },
                    {
                        key: "models",
                        label: "模型目录",
                        children: <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
                            <Card size="small" title={editingModel ? "编辑模型" : "新增模型"}>
                                <Form form={modelForm} layout="vertical" initialValues={{ capability: "image", creditCost: 1, enabled: true }} onFinish={modelSubmit}>
                                    <Form.Item name="providerId" label="所属供应商" rules={[{ required: true }]}><Select options={providers.map((provider) => ({ value: provider.id, label: provider.name }))} onChange={(id) => void discoverStudioProviderModels(id).then(setDiscovered).catch((error: unknown) => message.error(error instanceof Error ? error.message : "获取上游模型失败"))} /></Form.Item>
                                    <Form.Item name="model" label="模型 ID" rules={[{ required: true }]}><Select showSearch allowClear optionFilterProp="label" options={discovered.map((model) => ({ value: model.id, label: model.displayName || model.id }))} onSearch={(value) => modelForm.setFieldValue("model", value)} /></Form.Item>
                                    <Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}><Input /></Form.Item>
                                    <Form.Item name="capability" label="能力" rules={[{ required: true }]}><Select options={capabilityOptions} /></Form.Item>
                                    <Form.Item name="creditCost" label="基础积分" rules={[{ required: true }]}><InputNumber className="!w-full" min={0} /></Form.Item>
                                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                                    <Space><Button type="primary" htmlType="submit">保存</Button><Button onClick={() => { setEditingModel(null); modelForm.resetFields(); setDiscovered([]); }}>重置</Button></Space>
                                </Form>
                            </Card>
                            <Table rowKey={(row) => row.rowId || row.id} loading={loading} columns={modelColumns} dataSource={models} scroll={{ x: 900 }} pagination={{ pageSize: 10 }} />
                        </div>,
                    },
                    {
                        key: "concurrency",
                        label: "并发与轮询",
                        children: <div className="grid gap-5 lg:grid-cols-2">
                            <Card size="small" title="全站并发"><Space direction="vertical" className="w-full"><Typography.Text type="secondary">运行中：{runningTotal}，排队中：{queuedTotal}</Typography.Text><InputNumber className="!w-full" min={1} value={globalLimit} onChange={(value) => setGlobalLimit(Number(value || 1))} addonBefore="全站" /><InputNumber className="!w-full" min={1} value={defaultLimit} onChange={(value) => setDefaultLimit(Number(value || 1))} addonBefore="默认每用户" /><Button type="primary" onClick={() => void updateStudioConcurrencySettings(globalLimit, defaultLimit).then(() => { message.success("并发设置已保存"); return refresh(); }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))}>保存</Button></Space></Card>
                            <Card size="small" title={failoverModel ? `${failoverModel.displayName} 自动轮询` : "选择模型配置自动轮询"}>{failoverModel ? <Space direction="vertical" className="w-full"><Switch checked={failoverEnabled} onChange={setFailoverEnabled} checkedChildren="启用" unCheckedChildren="关闭" /><Select mode="multiple" className="w-full" value={failoverRoutes} onChange={setFailoverRoutes} placeholder="选择供应商模型" options={models.filter((model) => model.capability === failoverModel.capability).map((model) => ({ value: Number(model.rowId || model.id), label: `${model.provider} / ${model.model}` }))} /><div className="space-y-2">{failoverRoutes.map((id, index) => { const route = models.find((model) => Number(model.rowId || model.id) === id); return <div key={id} className="flex items-center justify-between border px-2 py-1 text-sm"><span>{index + 1}. {route ? `${route.provider} / ${route.model}` : id}</span><Space size={0}><Button type="text" size="small" icon={<ArrowUp className="size-4" />} disabled={index === 0} onClick={() => setFailoverRoutes((items) => items.map((item, position) => position === index ? items[index - 1] : position === index - 1 ? items[index] : item))} /><Button type="text" size="small" icon={<ArrowDown className="size-4" />} disabled={index === failoverRoutes.length - 1} onClick={() => setFailoverRoutes((items) => items.map((item, position) => position === index ? items[index + 1] : position === index + 1 ? items[index] : item))} /></Space></div>; })}</div><Button type="primary" onClick={() => void updateStudioModelFailover(Number(failoverModel.rowId || failoverModel.id), failoverEnabled, failoverRoutes).then(() => { message.success("轮询配置已保存"); return refresh(); }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))}>保存轮询配置</Button></Space> : <Typography.Text type="secondary">在模型目录中点击“轮询”开始配置。</Typography.Text>}</Card>
                            <Card size="small" title="用户并发覆盖" className="lg:col-span-2">
                                <Table size="small" rowKey={(row) => `${row.source}:${row.userId}`} dataSource={concurrencyUsers} pagination={{ pageSize: 8 }} scroll={{ x: 760 }} columns={[
                                    { title: "用户", dataIndex: "label" },
                                    { title: "运行中", dataIndex: "running" },
                                    { title: "排队中", dataIndex: "queued" },
                                    { title: "当前限制", dataIndex: "effectiveLimit" },
                                    { title: "覆盖值", render: (_: unknown, row) => <InputNumber min={1} placeholder="默认" value={row.overrideLimit ?? undefined} onChange={(value) => setConcurrencyUsers((items) => items.map((item) => item === row ? { ...item, overrideLimit: value ?? null } : item))} /> },
                                    { title: "操作", render: (_: unknown, row) => <Space size={4}><Button type="link" size="small" onClick={() => void (row.overrideLimit ? updateStudioUserConcurrency(row.source, row.userId, row.overrideLimit) : resetStudioUserConcurrency(row.source, row.userId)).then(() => { message.success("用户并发已更新"); return refresh(); }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "更新失败"))}>保存</Button><Button type="link" size="small" onClick={() => void resetStudioUserConcurrency(row.source, row.userId).then(() => refresh()).catch((error: unknown) => message.error(error instanceof Error ? error.message : "重置失败"))}>恢复默认</Button></Space> },
                                ]} />
                            </Card>
                        </div>,
                    },
                    {
                        key: "usage",
                        label: "使用/错误记录",
                        children: <Tabs items={[{ key: "all", label: `全部 (${usage.length})`, children: <Table rowKey="id" loading={loading} dataSource={usage} scroll={{ x: 1100 }} pagination={{ pageSize: 20 }} columns={[
                            { title: "时间", dataIndex: "created_at", render: (value: number) => value ? new Date(value * 1000).toLocaleString() : "-" },
                            { title: "用户", dataIndex: "username" }, { title: "供应商", dataIndex: "provider_name" }, { title: "模型", dataIndex: "model" }, { title: "能力", dataIndex: "capability" }, { title: "数量", dataIndex: "unit_count" }, { title: "积分", dataIndex: "credits" }, { title: "耗时", dataIndex: "elapsed_ms", render: (value: number) => value ? `${Math.round(value / 1000)} 秒` : "-" }, { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "succeeded" ? "success" : value === "failed" ? "error" : "default"}>{value}</Tag> }, { title: "错误", dataIndex: "error", ellipsis: true },
                        ]} /> }, { key: "errors", label: `错误 (${usage.filter((item) => item.status !== "succeeded").length})`, children: <Table rowKey="id" loading={loading} dataSource={usage.filter((item) => item.status !== "succeeded")} scroll={{ x: 1100 }} pagination={{ pageSize: 20 }} columns={[{ title: "时间", dataIndex: "created_at", render: (value: number) => value ? new Date(value * 1000).toLocaleString() : "-" }, { title: "用户", dataIndex: "username" }, { title: "供应商", dataIndex: "provider_name" }, { title: "模型", dataIndex: "model" }, { title: "状态", dataIndex: "status" }, { title: "错误", dataIndex: "error", ellipsis: true }]} /> }]} />,
                    },
                    {
                        key: "workflows",
                        label: "默认工作流",
                        children: <Table rowKey="key" loading={loading} dataSource={workflows} pagination={false} scroll={{ x: 900 }} columns={[
                            { title: "工作流", dataIndex: "name" },
                            { title: "说明", dataIndex: "description" },
                            { title: "启用", render: (_: unknown, row: StudioWorkflow) => <Switch checked={row.enabled} onChange={(enabled) => void updateStudioWorkflow(row.key, { enabled, accessMode: row.accessMode, allowedUsers: row.allowedUsers }).then(() => refresh()).catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))} /> },
                            { title: "访问范围", render: (_: unknown, row: StudioWorkflow) => <Select value={row.accessMode} options={[{ value: "all", label: "所有用户" }, { value: "selected", label: "指定用户" }]} onChange={(accessMode: "all" | "selected") => setWorkflows((items) => items.map((item) => item.key === row.key ? { ...item, accessMode } : item))} /> },
                            { title: "指定用户", render: (_: unknown, row: StudioWorkflow) => <Select mode="multiple" className="min-w-[260px]" value={row.allowedUsers} disabled={row.accessMode !== "selected"} options={workflowUsers} onChange={(allowedUsers: string[]) => setWorkflows((items) => items.map((item) => item.key === row.key ? { ...item, allowedUsers } : item))} /> },
                            { title: "操作", render: (_: unknown, row: StudioWorkflow) => <Button type="primary" size="small" onClick={() => void updateStudioWorkflow(row.key, { enabled: row.enabled, accessMode: row.accessMode, allowedUsers: row.allowedUsers }).then(() => { message.success("工作流设置已保存"); return refresh(); }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))}>保存</Button> },
                        ]} />,
                    },
                    {
                        key: "accounts",
                        label: "用户与账本",
                        children: <><Typography.Paragraph type="secondary">这里显示最近登录过 Studio 的 MassMore、Mtline 和 Studio 账户。余额来自账本桥接缓存，不展示上游令牌。</Typography.Paragraph><Table rowKey={(row) => `${row.source}:${row.userId}`} loading={loading} dataSource={accounts} scroll={{ x: 800 }} pagination={{ pageSize: 20 }} columns={[{ title: "来源", dataIndex: "source", render: (value: string) => <Tag>{value}</Tag> }, { title: "用户", dataIndex: "username" }, { title: "邮箱", dataIndex: "email" }, { title: "余额", dataIndex: "balance" }, { title: "Studio 积分", dataIndex: "points" }, { title: "同步时间", dataIndex: "updatedAt", render: (value: number) => value ? new Date(value * 1000).toLocaleString() : "-" }]} /></>,
                    },
                    {
                        key: "pricing",
                        label: "积分设置",
                        children: pricing ? <Card size="small" title="账本换算规则"><Form layout="vertical" initialValues={pricing} onFinish={(values: StudioPricingSettings) => void updateStudioPricingSettings(values).then(() => { message.success("积分设置已保存"); return refresh(); }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))}><div className="grid gap-4 md:grid-cols-2"><Form.Item name="pointsPerDollar" label="每 1 美元对应 Studio 积分" rules={[{ required: true }]}><InputNumber min={0.0001} className="!w-full" /></Form.Item><Form.Item name="sourceBalanceUnitsPerDollar" label="通用账本单位/美元" rules={[{ required: true }]}><InputNumber min={0.0001} className="!w-full" /></Form.Item><Form.Item name="massmoreSourceBalanceUnitsPerDollar" label="MassMore 账本单位/美元" rules={[{ required: true }]}><InputNumber min={0.0001} className="!w-full" /></Form.Item><Form.Item name="mtlineSourceBalanceUnitsPerDollar" label="Mtline 账本单位/美元" rules={[{ required: true }]}><InputNumber min={0.0001} className="!w-full" /></Form.Item></div><Typography.Paragraph type="secondary">模型基础积分和图片/视频质量、分辨率等附加规则仍在“模型目录”的模型编辑配置中维护，前端显示与后端扣费使用同一套规则。</Typography.Paragraph><Button type="primary" htmlType="submit">保存积分设置</Button></Form></Card> : <Typography.Text type="secondary">正在加载积分设置...</Typography.Text>,
                    },
                ]}
            />
        </div>
    );
}
