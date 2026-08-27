"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { isStudioManagedHost } from "@/services/studio-managed";

export default function AdminPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace(isStudioManagedHost() ? "/admin/studio" : "/admin/users");
    }, [router]);
    return null;
}
