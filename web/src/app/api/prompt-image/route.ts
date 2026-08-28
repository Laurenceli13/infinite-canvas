import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedHosts = new Set(["cdn.imgedify.com", "cdn.jsdelivr.net", "raw.githubusercontent.com", "github.com", "i.ibb.co", "i.imgur.com"]);

export async function GET(request: NextRequest) {
    const rawUrl = request.nextUrl.searchParams.get("url") || "";
    let target: URL;
    try {
        target = new URL(rawUrl);
    } catch {
        return new Response("invalid image url", { status: 400 });
    }

    if (target.protocol !== "https:" || !allowedHosts.has(target.hostname)) {
        return new Response("image host is not allowed", { status: 403 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(target, {
            signal: controller.signal,
            headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", "User-Agent": "InfiniteCanvasPromptImageProxy/1.0" },
            cache: "force-cache",
        });
        if (!response.ok || !response.body) return new Response("image unavailable", { status: response.status || 502 });

        const headers = new Headers();
        headers.set("Content-Type", response.headers.get("content-type") || "image/jpeg");
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
        return new Response(response.body, { status: 200, headers });
    } catch {
        return new Response("image unavailable", { status: 504 });
    } finally {
        clearTimeout(timeout);
    }
}
