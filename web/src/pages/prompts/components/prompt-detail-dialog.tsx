import { Copy, FolderPlus } from "lucide-react";
import { Button, Modal, Space, Tag } from "antd";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";
import { PromptCover } from "@/components/prompts/prompt-cover";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    const locale = useStudioLocaleStore((state) => state.locale);
    const text =
        locale === "zh"
            ? {
                  created: "创建",
                  updated: "更新",
                  copy: "复制提示词",
                  addToAssets: "加入我的素材",
              }
            : {
                  created: "Created",
                  updated: "Updated",
                  copy: "Copy Prompt",
                  addToAssets: "Add to Assets",
              };

    return (
        <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={860}>
            {prompt ? (
                <div className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
                    <div className="space-y-3">
                        <PromptCover src={prompt.coverUrl} alt={prompt.title} className="aspect-[4/3] w-full rounded-lg object-cover" />
                        {prompt.preview ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                    </div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap gap-1.5">
                            {prompt.tags.map((tag) => (
                                <Tag key={tag} className="m-0">
                                    {tag}
                                </Tag>
                            ))}
                        </div>
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                        <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                            {text.created}: {formatPromptDate(prompt.createdAt)} · {text.updated}: {formatPromptDate(prompt.updatedAt)}
                        </div>
                        <Space wrap className="mt-5">
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                {text.copy}
                            </Button>
                            {onSaveAsset ? (
                                <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                    {text.addToAssets}
                                </Button>
                            ) : null}
                        </Space>
                    </div>
                </div>
            ) : null}
        </Modal>
    );
}
