import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, DatePicker, Input, Modal, Select, Space, Table, Tag } from "antd";

import { fetchMyStudioUsage, submitStudioUsageReport, type StudioUsage } from "@/services/studio-managed";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";

type FilterState = {
    model: string;
    capability: string;
    status: string;
    range: [number | undefined, number | undefined];
};

export default function UsagePage() {
    const { message } = App.useApp();
    const locale = useStudioLocaleStore((state) => state.locale);
    const [usage, setUsage] = useState<StudioUsage[]>([]);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState<FilterState>({ model: "", capability: "", status: "", range: [undefined, undefined] });
    const [reportTarget, setReportTarget] = useState<StudioUsage | null>(null);
    const [reportNote, setReportNote] = useState("");
    const [reporting, setReporting] = useState(false);

    const load = async (nextFilters = filters) => {
        setLoading(true);
        try {
            setUsage(
                await fetchMyStudioUsage({
                    model: nextFilters.model || undefined,
                    capability: nextFilters.capability || undefined,
                    status: nextFilters.status || undefined,
                    from: nextFilters.range[0],
                    to: nextFilters.range[1],
                    limit: 200,
                }),
            );
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "加载使用明细失败" : "Failed to load usage history");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const modelOptions = useMemo(() => Array.from(new Set(usage.map((item) => item.model))).map((value) => ({ value, label: value })), [usage]);
    const copyReport = async (item: StudioUsage) => {
        const content = [
            "Studio 使用问题明细",
            `错误代码: ${item.external_key}`,
            `时间: ${new Date(item.created_at * 1000).toLocaleString(locale === "zh" ? "zh-CN" : "en-US")}`,
            `模型: ${item.model}`,
            `能力: ${item.capability}`,
            `状态: ${item.status}`,
            `数量: ${formatQuantity(item, locale)}`,
            `积分: ${formatPoints(item.credits)}`,
            `错误信息: ${item.error || "-"}`,
        ].join("\n");
        try {
            await navigator.clipboard.writeText(content);
            message.success(locale === "zh" ? "问题明细已复制，可直接发送给管理员" : "Issue details copied");
        } catch {
            message.error(locale === "zh" ? "复制失败，请手动记录错误代码" : "Copy failed. Please record the error code manually.");
        }
    };

    const reset = () => {
        const next = { model: "", capability: "", status: "", range: [undefined, undefined] as [undefined, undefined] };
        setFilters(next);
        void load(next);
    };

    const submitReport = async () => {
        if (!reportTarget) return;
        setReporting(true);
        try {
            await submitStudioUsageReport(reportTarget.external_key, reportNote);
            message.success(locale === "zh" ? "已提交给管理员处理" : "Submitted for administrator review");
            setReportTarget(null);
            setReportNote("");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : locale === "zh" ? "提交失败" : "Submission failed");
        } finally {
            setReporting(false);
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-stone-50 p-4 text-stone-950 dark:bg-stone-950 dark:text-stone-100 md:p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-5">
                    <h1 className="text-2xl font-semibold">{locale === "zh" ? "我的使用明细" : "My Usage"}</h1>
                    <p className="mt-1 text-sm text-stone-500">{locale === "zh" ? "查看积分消耗、退款与失败原因。失败任务可复制问题明细交给管理员处理。" : "Review credits, refunds, and failures. Copy failed task details for your administrator."}</p>
                </div>
                <Card>
                    <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1.5fr_auto]">
                        <Select allowClear showSearch optionFilterProp="label" placeholder={locale === "zh" ? "筛选模型" : "Model"} value={filters.model || undefined} options={modelOptions} onChange={(model) => setFilters((current) => ({ ...current, model: model || "" }))} />
                        <Select allowClear placeholder={locale === "zh" ? "能力" : "Capability"} value={filters.capability || undefined} options={[{ value: "text", label: locale === "zh" ? "文字" : "Text" }, { value: "image", label: locale === "zh" ? "图片" : "Image" }, { value: "video", label: locale === "zh" ? "视频" : "Video" }, { value: "audio", label: locale === "zh" ? "音频" : "Audio" }]} onChange={(capability) => setFilters((current) => ({ ...current, capability: capability || "" }))} />
                        <Select allowClear placeholder={locale === "zh" ? "状态" : "Status"} value={filters.status || undefined} options={[{ value: "success", label: locale === "zh" ? "成功" : "Success" }, { value: "refunded", label: locale === "zh" ? "已退款" : "Refunded" }, { value: "refund_failed", label: locale === "zh" ? "退款异常" : "Refund failed" }, { value: "charged", label: locale === "zh" ? "处理中" : "Processing" }]} onChange={(status) => setFilters((current) => ({ ...current, status: status || "" }))} />
                        <DatePicker.RangePicker className="w-full" showTime onChange={(range) => setFilters((current) => ({ ...current, range: [range?.[0]?.unix(), range?.[1]?.unix()] }))} />
                        <Space>
                            <Button type="primary" onClick={() => void load()}>{locale === "zh" ? "查询" : "Search"}</Button>
                            <Button onClick={reset}>{locale === "zh" ? "重置" : "Reset"}</Button>
                        </Space>
                    </div>
                    <Table
                        rowKey="external_key"
                        loading={loading}
                        dataSource={usage}
                        size="middle"
                        pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => (locale === "zh" ? `共 ${total} 条` : `${total} records`) }}
                        scroll={{ x: 980 }}
                        columns={[
                            { title: locale === "zh" ? "时间" : "Time", dataIndex: "created_at", width: 168, render: (value: number) => new Date(value * 1000).toLocaleString(locale === "zh" ? "zh-CN" : "en-US") },
                            { title: locale === "zh" ? "模型" : "Model", dataIndex: "model", width: 180, ellipsis: true },
                            { title: locale === "zh" ? "能力" : "Capability", dataIndex: "capability", width: 86, render: (value: string) => <Tag>{value}</Tag> },
                            { title: locale === "zh" ? "数量" : "Quantity", width: 96, render: (_, item) => formatQuantity(item, locale) },
                            { title: locale === "zh" ? "消耗积分" : "Credits", dataIndex: "credits", width: 104, render: (value: number) => formatPoints(value) },
                            { title: locale === "zh" ? "耗时" : "Elapsed", dataIndex: "elapsed_ms", width: 90, render: formatElapsed },
                            { title: locale === "zh" ? "状态" : "Status", dataIndex: "status", width: 110, render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag> },
                            {
                                title: locale === "zh" ? "问题处理" : "Issue",
                                width: 206,
                                render: (_, item) =>
                                    item.status === "success" ? (
                                        "-"
                                    ) : (
                                        <Space size="small">
                                            <Button size="small" onClick={() => void copyReport(item)}>{locale === "zh" ? "复制明细" : "Copy"}</Button>
                                            <Button size="small" type={item.report_status === "open" ? "default" : "primary"} disabled={item.report_status === "open"} onClick={() => setReportTarget(item)}>
                                                {item.report_status === "open" ? (locale === "zh" ? "待处理" : "Open") : locale === "zh" ? "提交处理" : "Report"}
                                            </Button>
                                        </Space>
                                    ),
                            },
                        ]}
                    />
                </Card>
            </div>
            <Modal title={locale === "zh" ? "提交问题处理" : "Submit issue"} open={Boolean(reportTarget)} confirmLoading={reporting} okText={locale === "zh" ? "提交" : "Submit"} cancelText={locale === "zh" ? "取消" : "Cancel"} onOk={() => void submitReport()} onCancel={() => !reporting && setReportTarget(null)}>
                <div className="mb-3 text-sm text-stone-500">{locale === "zh" ? `错误代码：${reportTarget?.external_key || ""}` : `Error code: ${reportTarget?.external_key || ""}`}</div>
                <Input.TextArea rows={4} maxLength={1000} showCount value={reportNote} onChange={(event) => setReportNote(event.target.value)} placeholder={locale === "zh" ? "请补充生成结果、扣分异常或复现情况（可留空）" : "Add any reproduction details or billing concern (optional)"} />
            </Modal>
        </main>
    );
}

function formatQuantity(item: StudioUsage, locale: "zh" | "en") {
    const count = Number(item.unit_count || 1);
    if (item.capability === "image") return locale === "zh" ? `${count} 张` : `${count} images`;
    if (item.capability === "video") return locale === "zh" ? `${count} 秒` : `${count} sec`;
    return locale === "zh" ? `${count} 次` : `${count} calls`;
}

function formatPoints(value?: number) {
    return Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatElapsed(value?: number) {
    const ms = Number(value || 0);
    return !ms ? "-" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function statusColor(status: string) {
    if (status === "success") return "green";
    if (status.includes("refund")) return "orange";
    if (status === "charged" || status === "pending") return "blue";
    return "red";
}
