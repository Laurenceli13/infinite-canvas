"use client";

import { App, Empty, Spin, Table, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { fetchStudioUsage, isStudioManagedHost, type StudioUsage } from "@/services/studio-managed";

const capabilityLabels: Record<string, string> = { image: "图片", video: "视频", text: "文字", audio: "音频" };
const statusLabels: Record<string, string> = { succeeded: "成功", success: "成功", failed: "失败", refunded: "已退回", refund_failed: "退回失败", running: "生成中", queued: "排队中", cancelled: "已取消" };

export default function UsagePage() {
    const { message } = App.useApp();
    const [rows, setRows] = useState<StudioUsage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isStudioManagedHost()) {
            setLoading(false);
            return;
        }
        void fetchStudioUsage({ limit: 500 })
            .then(setRows)
            .catch((error) => message.error(error instanceof Error ? error.message : "读取使用记录失败"))
            .finally(() => setLoading(false));
    }, [message]);

    if (!isStudioManagedHost()) {
        return <main className="mx-auto max-w-5xl p-6"><Empty description="当前站点未启用 Studio 使用记录" /></main>;
    }

    return (
        <main className="min-h-full overflow-auto bg-background px-6 py-8">
            <div className="mx-auto max-w-7xl">
                <Typography.Title level={3}>我的使用记录</Typography.Title>
                <Typography.Paragraph type="secondary">查看自己的积分消耗、模型、数量以及生成成功或失败明细。</Typography.Paragraph>
                <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={rows}
                    scroll={{ x: 1050 }}
                    pagination={{ pageSize: 20, showSizeChanger: true }}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无使用记录" /> }}
                    columns={[
                        { title: "时间", dataIndex: "created_at", render: (value: number) => value ? new Date(value * 1000).toLocaleString() : "-" },
                        { title: "来源", dataIndex: "source", render: (value: string) => <Tag>{value || "-"}</Tag> },
                        { title: "供应商", dataIndex: "provider_name", render: (value: string) => value || "-" },
                        { title: "模型", dataIndex: "model", ellipsis: true },
                        { title: "能力", dataIndex: "capability", render: (value: string) => capabilityLabels[value] || value || "-" },
                        { title: "数量", dataIndex: "unit_count" },
                        { title: "消耗积分", dataIndex: "credits", render: (value: number) => Number(value || 0).toLocaleString() },
                        { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "succeeded" || value === "success" ? "success" : value === "failed" || value === "refund_failed" ? "error" : "default"}>{statusLabels[value] || value || "-"}</Tag> },
                        { title: "错误信息", dataIndex: "error", ellipsis: true, render: (value: string) => value || "-" },
                    ]}
                />
            </div>
        </main>
    );
}
