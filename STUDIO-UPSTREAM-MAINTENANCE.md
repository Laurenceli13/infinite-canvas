# Studio upstream maintenance

This repository keeps the public Infinite Canvas project and the Studio-managed customizations in separate Git history.

## Branches

- `codex/studio-upstream-sync`: production source with Studio customizations.
- `upstream/v0.12.1-snapshot`: clean upstream `v0.12.1` snapshot.
- Create a new `upstream/vX.Y.Z-snapshot` branch for every future official release.

## Protected Studio areas

Do not replace these features with upstream-only implementations during an update:

- Managed credits, resolution/quality pricing, refunds, usage records, and concurrency queues.
- Studio administrator pages, provider/model tests, failover routing, and user access controls.
- MassMore and Mtline account, balance, and billing synchronization.
- Industry workflows, workflow visibility rules, workflow file previews, and SKILL integration.
- Managed image/video job recovery, cancellation, idempotency, result polling, and temporary asset delivery.
- Image preview delivery: the managed backend exposes HTTPS image URLs as soon as an upstream image response is available; the browser may show that preview while IndexedDB persistence finishes.
- Managed host behavior for both `studio.massmore.org` and `studio.linkfoai.com`.

## Update procedure

1. Commit all deployed Studio changes on `codex/studio-upstream-sync`.
2. Import the official release into a clean `upstream/vX.Y.Z-snapshot` branch based on the previous upstream snapshot.
3. Merge that snapshot into `codex/studio-upstream-sync` with a normal three-way merge.
4. Resolve conflicts in favor of the Studio business behavior, then adapt it to new upstream component and type contracts.
5. Run `npm run typecheck` and `npm run build` in `web`.
6. Back up the production web root, deploy atomically, and verify both Studio domains against the same bundle.

The managed backend is deployed separately at `/opt/studio-managed/studio_managed_backend.py`. Backend schema changes must be deployed with a database backup, service restart, health check, and rollback copy; do not overwrite it as part of a clean upstream frontend import.

Never deploy an upstream archive directly over the production web root.
