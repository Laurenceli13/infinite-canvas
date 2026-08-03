import { useEffect, useMemo } from "react";
import { Trash2 } from "lucide-react";

type WorkflowFilePreviewGridProps = {
    files: File[];
    disabled?: boolean;
    maxHeightClassName?: string;
    onRemove: (index: number) => void;
};

export function WorkflowFilePreviewGrid({ files, disabled, maxHeightClassName = "max-h-56", onRemove }: WorkflowFilePreviewGridProps) {
    const previews = useMemo(
        () =>
            files.map((file, index) => ({
                file,
                index,
                url: URL.createObjectURL(file),
            })),
        [files],
    );

    useEffect(
        () => () => {
            previews.forEach((preview) => URL.revokeObjectURL(preview.url));
        },
        [previews],
    );

    if (!previews.length) return null;

    return (
        <div className={`mt-2 grid grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4 ${maxHeightClassName}`}>
            {previews.map(({ file, index, url }) => (
                <figure key={`${file.name}-${file.lastModified}-${index}`} className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-950">
                    <img src={url} alt={file.name} className="aspect-square w-full bg-stone-100 object-cover dark:bg-stone-900" />
                    <figcaption className="min-w-0 px-2 py-1.5">
                        <div className="truncate text-xs font-medium text-stone-800 dark:text-stone-100" title={file.name}>
                            {file.name}
                        </div>
                        <div className="mt-0.5 text-[10px] tabular-nums text-stone-400">{formatFileSize(file.size)}</div>
                    </figcaption>
                    {!disabled ? (
                        <button
                            type="button"
                            className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/70 text-white opacity-0 shadow-sm transition hover:bg-rose-600 group-hover:opacity-100 focus:opacity-100"
                            aria-label={`移除 ${file.name}`}
                            onClick={() => onRemove(index)}
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    ) : null}
                </figure>
            ))}
        </div>
    );
}

function formatFileSize(size: number) {
    if (!Number.isFinite(size) || size <= 0) return "0 KB";
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
