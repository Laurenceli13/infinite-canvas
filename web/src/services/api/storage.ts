import { apiDelete, apiGet, apiPost } from "@/services/api/request";
import type { UserWebDAVStorageProvider } from "@/services/image-storage";
import { isStudioManagedHost, studioApi } from "@/services/studio-managed";

export type RegisteredStorageObject = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
};

export type StorageObjectInfo = {
    id: string;
    objectKey: string;
    publicUrl: string;
    mimeType: string;
    bytes: number;
    direct: boolean;
};

export function getStorageObjectInfo(id: string) {
    if (isStudioManagedHost()) {
        return fetch(studioApi(`/files/${encodeURIComponent(id)}/info`), { credentials: "same-origin" })
            .then(async (response) => {
                const payload = await response.json().catch(() => null) as { success?: boolean; message?: string; file?: { id: string; storageKey: string; url: string; objectKey?: string; direct?: boolean; mimeType: string; bytes: number } } | null;
                if (!response.ok || !payload?.success || !payload.file) throw new Error(payload?.message || "读取存储对象失败");
                return {
                    id: payload.file.id,
                    objectKey: payload.file.objectKey || "",
                    publicUrl: payload.file.url,
                    mimeType: payload.file.mimeType,
                    bytes: payload.file.bytes,
                    direct: payload.file.direct === true,
                } satisfies StorageObjectInfo;
            });
    }
    return apiGet<StorageObjectInfo>(`/api/files/${encodeURIComponent(id)}`);
}

export function registerDirectStorageObject(
    token: string,
    payload: { provider: UserWebDAVStorageProvider; objectKey: string; mimeType: string; bytes: number },
) {
    if (isStudioManagedHost()) {
        return fetch(studioApi("/files/direct"), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: payload.provider, objectKey: payload.objectKey, mimeType: payload.mimeType, bytes: payload.bytes }),
        }).then(async (response) => {
            const body = await response.json().catch(() => null) as { success?: boolean; message?: string; file?: RegisteredStorageObject } | null;
            if (!response.ok || !body?.success || !body.file) throw new Error(body?.message || "登记存储对象失败");
            return body.file;
        });
    }
    return apiPost<RegisteredStorageObject>("/api/v1/files/direct", payload, token);
}

export function deleteDirectStorageObjectRecord(token: string, id: string) {
    if (isStudioManagedHost()) {
        return fetch(studioApi(`/files/${encodeURIComponent(id)}`), { method: "DELETE", credentials: "same-origin" }).then(async (response) => {
            const body = await response.json().catch(() => null) as { success?: boolean; message?: string } | null;
            if (!response.ok || !body?.success) throw new Error(body?.message || "删除存储对象记录失败");
            return true;
        });
    }
    return apiDelete<boolean>(`/api/v1/files/${encodeURIComponent(id)}/record`, token);
}
