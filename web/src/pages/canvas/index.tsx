import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { useStudioLocaleStore } from "@/stores/use-studio-locale-store";

const copy = {
    zh: {
        importSuccess: (count: number) => `已导入 ${count} 个画布`,
        importError: "导入失败，请选择有效的画布压缩包",
        opening: "正在打开画布...",
        library: "画布库",
        title: "无限画布",
        exportCanvas: "导出画布",
        exportSelected: "导出选中",
        deleteSelected: "删除选中",
        deleteAll: "删除全部",
        importCanvas: "导入画布",
        newCanvas: "新建画布",
        loading: "正在加载画布...",
        emptyTitle: "还没有画布",
        emptyDesc: "新建一个画布后，就可以独立保存节点、连线和画布外观。",
    },
    en: {
        importSuccess: (count: number) => `Imported ${count} canvases`,
        importError: "Import failed. Please choose a valid canvas package.",
        opening: "Opening canvas...",
        library: "Canvas Library",
        title: "Infinite Canvas",
        exportCanvas: "Export Canvas",
        exportSelected: "Export Selected",
        deleteSelected: "Delete Selected",
        deleteAll: "Delete All",
        importCanvas: "Import Canvas",
        newCanvas: "New Canvas",
        loading: "Loading canvases...",
        emptyTitle: "No canvases yet",
        emptyDesc: "Create a canvas to save nodes, connections, and its full working layout.",
    },
};

export default function CanvasPage() {
    const { message } = App.useApp();
    const locale = useStudioLocaleStore((state) => state.locale);
    const text = copy[locale];
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const nextProjectTitle = `${text.title} ${projects.length + 1}`;

    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };

    const createAndEnter = () => enterProject(createProject(nextProjectTitle));

    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(text.importSuccess(data.projects.length));
        } catch {
            message.error(text.importError);
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(nextProjectTitle) : projects[0]?.id || createProject(nextProjectTitle));
    }, [createProject, hydrated, mode, nextProjectTitle, projects]);

    if (hydrated && (mode === "new" || mode === "recent")) {
        return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{text.opening}</main>;
    }

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">{text.library}</p>
                        <h1 className="mt-3 text-3xl font-semibold">{text.title}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${text.title}-${selectedIds.length}`)}>
                                    {text.exportSelected}
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    {text.deleteSelected}
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {text.deleteAll}
                            </Button>
                        ) : null}
                        {projects.length && !selectedIds.length ? (
                            <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects, `${text.title}-${projects.length}`)}>
                                {text.exportCanvas}
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {text.importCanvas}
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {text.newCanvas}
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">{text.loading}</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">{text.emptyTitle}</h2>
                        <p className="mt-3 text-sm text-stone-500">{text.emptyDesc}</p>
                        <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            {text.newCanvas}
                        </Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
