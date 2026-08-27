import type { CanvasProject } from "@/app/(user)/canvas/stores/use-canvas-store";
import { apiGet, apiPost } from "@/services/api/request";
import { isStudioManagedHost } from "@/services/studio-managed";
import { useUserStore } from "@/stores/use-user-store";

export async function listCanvasProjects(token: string) {
    if (isStudioManagedHost()) return [];
    return apiGet<CanvasProject[]>("/api/v1/canvas/projects", undefined, token);
}

export async function saveCanvasProject(
    token: string,
    project: CanvasProject,
) {
    if (isStudioManagedHost()) return project;
    return apiPost<CanvasProject>(
        "/api/v1/canvas/projects",
        { data: project },
        token,
    );
}

export async function syncCanvasProjects(
    token: string,
    projects: CanvasProject[],
) {
    if (isStudioManagedHost()) return projects;
    return apiPost<CanvasProject[]>(
        "/api/v1/canvas/projects/sync",
        { projects },
        token,
    );
}

export async function deleteCanvasTasks(sourceId: string, nodeIds: string[] = []) {
    if (isStudioManagedHost()) return;
    const token = useUserStore.getState().token;
    const source = sourceId.trim();
    if (!token || !source) return;
    return apiPost<{ deleted: boolean }>(
        "/api/v1/canvas/tasks/delete",
        {
            source_id: source,
            node_ids: Array.from(new Set(nodeIds.map((id) => id.trim()).filter(Boolean))),
        },
        token,
    );
}

export async function deleteCanvasProjects(ids: string[]) {
    if (isStudioManagedHost()) return;
    const token = useUserStore.getState().token;
    const projectIds = Array.from(
        new Set(ids.map((id) => id.trim()).filter(Boolean)),
    );
    if (!token || !projectIds.length) return;
    return apiPost<{ deleted: boolean }>(
        "/api/v1/canvas/projects/delete",
        { ids: projectIds },
        token,
    );
}
