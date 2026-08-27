"use client";

import { App, Button, Card, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
    createStudioModel,
    createStudioProvider,
    deleteStudioModel,
    deleteStudioProvider,
    discoverStudioProviderModels,
    fetchStudioAdminModels,
    fetchStudioConcurrency,
    fetchStudioProviders,
    fetchStudioUsage,
    isStudioManagedHost,
    testStudioModel,
    testStudioProvider,
    updateStudioConcurrencySettings,
    updateStudioModel,
    updateStudioModelFailover,
    updateStudioProvider,
    type StudioModel,
    type StudioProvider,
    type StudioUsage,
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
    const router = useRouter();
    const { message } = App.useApp();
    const [providers, setProviders] = useState<StudioProvider[]>([]);
    const [models, setModels] = useState<StudioModel[]>([]);
    const [usage, setUsage] = useState<StudioUsage[]>([]);
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
            const [nextProviders, nextModels, nextUsage, concurrency] = await Promise.all([fetchStudioProviders(), fetchStudioAdminModels(), fetchStudioUsage(), fetchStudioConcurrency()]);
            setProviders(nextProviders);
            setModels(nextModels);
            setUsage(nextUsage);
            setGlobalLimit(concurrency.globalLimit);
            setDefaultLimit(concurrency.defaultLimit);
            setRunningTotal(concurrency.runningTotal);
            setQueuedTotal(concurrency.queuedTotal);
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
                            <Card size="small" title="全站并发"><Space direction="vertical" className="w-full"><Typography.Text type="secondary">运行中：{runningTotal}，排队中：{queuedTotal}</Typography.Text><InputNumber className="!w-full" min={0} value={globalLimit} onChange={(value) => setGlobalLimit(Number(value || 0))} addonBefore="全站" /><InputNumber className="!w-full" min={1} value={defaultLimit} onChange={(value) => setDefaultLimit(Number(value || 1))} addonBefore="默认每用户" /><Button type="primary" onClick={() => void updateStudioConcurrencySettings(globalLimit, defaultLimit).then(() => { message.success("并发设置已保存"); return refresh(); }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))}>保存</Button></Space></Card>
                            <Card size="small" title={failoverModel ? `${failoverModel.displayName} 自动轮询` : "选择模型配置自动轮询"}>{failoverModel ? <Space direction="vertical" className="w-full"><Switch checked={failoverEnabled} onChange={setFailoverEnabled} checkedChildren="启用" unCheckedChildren="关闭" /><Select mode="multiple" className="w-full" value={failoverRoutes} onChange={setFailoverRoutes} placeholder="选择供应商模型" options={models.filter((model) => model.capability === failoverModel.capability).map((model) => ({ value: Number(model.rowId || model.id), label: `${model.provider} / ${model.model}` }))} /><div className="space-y-2">{failoverRoutes.map((id, index) => { const route = models.find((model) => Number(model.rowId || model.id) === id); return <div key={id} className="flex items-center justify-between border px-2 py-1 text-sm"><span>{index + 1}. {route ? `${route.provider} / ${route.model}` : id}</span><Space size={0}><Button type="text" size="small" icon={<ArrowUp className="size-4" />} disabled={index === 0} onClick={() => setFailoverRoutes((items) => items.map((item, position) => position === index ? items[index - 1] : position === index - 1 ? items[index] : item))} /><Button type="text" size="small" icon={<ArrowDown className="size-4" />} disabled={index === failoverRoutes.length - 1} onClick={() => setFailoverRoutes((items) => items.map((item, position) => position === index ? items[index + 1] : position === index + 1 ? items[index] : item))} /></Space></div>; })}</div><Button type="primary" onClick={() => void updateStudioModelFailover(Number(failoverModel.rowId || failoverModel.id), failoverEnabled, failoverRoutes).then(() => { message.success("轮询配置已保存"); return refresh(); }).catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))}>保存轮询配置</Button></Space> : <Typography.Text type="secondary">在模型目录中点击“轮询”开始配置。</Typography.Text>}</Card>
                        </div>,
                    },
                    {
                        key: "usage",
                        label: "使用记录",
                        children: <Table rowKey="id" loading={loading} dataSource={usage} scroll={{ x: 960 }} pagination={{ pageSize: 20 }} columns={[
                            { title: "时间", dataIndex: "created_at", render: (value: number) => value ? new Date(value * 1000).toLocaleString() : "-" },
                            { title: "用户", dataIndex: "username" }, { title: "供应商", dataIndex: "provider_name" }, { title: "模型", dataIndex: "model" }, { title: "能力", dataIndex: "capability" }, { title: "数量", dataIndex: "unit_count" }, { title: "积分", dataIndex: "credits" }, { title: "耗时", dataIndex: "elapsed_ms", render: (value: number) => value ? `${Math.round(value / 1000)} 秒` : "-" }, { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "succeeded" ? "success" : value === "failed" ? "error" : "default"}>{value}</Tag> }, { title: "错误", dataIndex: "error", ellipsis: true },
                        ]} />,
                    },
                ]}
            />
        </div>
    );
}
