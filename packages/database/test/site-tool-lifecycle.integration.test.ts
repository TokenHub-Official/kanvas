import {
  createToolSessionStore,
  type ToolSessionStore,
} from "../src/runtime/tool-session-store.js";
import {
  createSiteToolImageStore,
  type SiteToolImageStore,
} from "../src/runtime/site-tool-image-store.js";
import type {
  TrustedWorkspaceScope,
  TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import {
  htmlToolPolicyVersion,
  type ToolPresentation,
} from "@kanvas/contracts/api";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSiteToolStore,
  type SiteToolStore,
  type SiteToolCommand,
} from "../src/runtime/site-tool-store.js";
import {
  createDisposableIntegrationPool,
  disposableIntegrationDatabase,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const id = (n: number) => `01K${String(n).padStart(23, "0")}`;
const now = new Date("2026-09-23T10:00:00Z");
const authority: TrustedInstanceAdministratorScope = {
  instanceId: "site-tool-lifecycle",
  principalId: id(1),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "test-browser-session",
  authorityType: "instance_administrator",
  authorityId: id(1),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  trusted: true,
};
const userScope: TrustedWorkspaceScope = {
  workspaceId: id(11),
  organizationId: id(10),
  principalId: id(2),
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "member-session",
  authorityType: "human_membership",
  authorityId: id(12),
  authorityVersion: 1,
  authorizationModelVersion: 1,
  trusted: true,
  effectivePermissions: ["workspace.read"],
};
const presentation: ToolPresentation = {
  slug: "calculator",
  displayName: "计算器",
  summary: "",
  descriptionMarkdown: "",
  logoImageId: null,
  coverImageId: null,
  category: "",
  tags: [],
};
describe.skipIf(!disposableIntegrationDatabase)(
  "site administrator tool lifecycle",
  () => {
    let pool: Pool;
    let store: SiteToolStore;
    let images: SiteToolImageStore;
    let sessions: ToolSessionStore;
    let logoId: string;
    let orphanId: string;
    let toolId: string;
    let key = 0;
    const mutate = (command: SiteToolCommand) =>
      store.mutate(authority, `operation-${++key}`, command, (input) => ({
        policyVersion: htmlToolPolicyVersion,
        checkedDigest: input.digest,
        passed: true,
        issues: [],
        checkedAt: input.now.toISOString(),
      }));
    beforeAll(async () => {
      pool = createDisposableIntegrationPool();
      const c = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(c);
        for (const principal of [id(1), id(2)]) {
          await c.execute(
            "INSERT INTO principal (id, principal_type, status, version, created_at, updated_at) VALUES (?, 'human', 'active', 1, ?, ?)",
            [principal, now, now],
          );
          await c.execute(
            "INSERT INTO human_principal (principal_id, auth_subject_id, created_at) VALUES (?, ?, ?)",
            [principal, principal, now],
          );
        }
        await c.execute(
          "INSERT INTO organization (id, slug, name, status, version, created_at, updated_at) VALUES (?, 'tool-users', 'Tool users', 'active', 1, ?, ?)",
          [id(10), now, now],
        );
        await c.execute(
          "INSERT INTO workspace (id, organization_id, slug, name, status, version, created_at, updated_at) VALUES (?, ?, 'tool-users', 'Tool users', 'active', 1, ?, ?)",
          [id(11), id(10), now, now],
        );
        await c.execute(
          "INSERT INTO workspace_membership (id, organization_id, workspace_id, principal_id, role, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'viewer', 'active', 1, ?, ?)",
          [id(12), id(10), id(11), id(2), now, now],
        );
        await c.execute(
          "INSERT INTO instance_administrator (principal_id, status, version, created_at, updated_at) VALUES (?, 'active', 1, ?, ?)",
          [id(1), now, now],
        );
        await c.execute(
          "INSERT INTO instance_runtime_state (instance_id, state, reason, changed_by, changed_at) VALUES (?, 'ACTIVE', 'test', 'test', ?)",
          [authority.instanceId, now],
        );
      } finally {
        c.release();
      }
      sessions = createToolSessionStore(pool, authority.instanceId, () => now);
      images = createSiteToolImageStore(pool, authority.instanceId);
      let next = 100;
      store = createSiteToolStore(pool, {
        instanceId: authority.instanceId,
        now: () => now,
        nextId: () => id(++next),
      });
    });
    afterAll(async () => {
      await pool?.end();
    });

    it("stores artwork idempotently and keeps unattached images private", async () => {
      const image = {
        bytes: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
        width: 1,
        height: 1,
      };
      const uploaded = await images.upload(authority, "logo-upload", image);
      expect(await images.upload(authority, "logo-upload", image)).toEqual(
        uploaded,
      );
      logoId = uploaded.imageId;
      orphanId = (await images.upload(authority, "orphan-upload", image))
        .imageId;
      presentation.logoImageId = logoId;
      expect(
        (await images.readForAdministrator(authority, logoId)).bytes,
      ).toEqual(image.bytes);
      await expect(images.readForUser(userScope, logoId)).rejects.toMatchObject(
        { code: "not_found" },
      );
      await expect(
        images.upload(
          { ...authority, principalId: id(2), authorityId: id(2) },
          "unauthorized-upload",
          image,
        ),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });
      await expect(
        images.upload(authority, "logo-upload", { ...image, width: 2 }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("preserves semantic tool icons across publication, catalogue and replacement", async () => {
      const emoji = {
        kind: "emoji",
        value: "👩🏽‍💻",
        backgroundColor: "#EEF2FF",
      } as const;
      const initial = {
        ...presentation,
        slug: "semantic-icon-qa",
        logoImageId: null,
        symbol: emoji,
      };
      let result = await mutate({ kind: "create", presentation: initial });
      const semanticId = result.toolId;
      expect((await store.detail(authority, semanticId)).tool.symbol).toEqual(
        emoji,
      );
      expect(
        (await store.list(authority)).find((tool) => tool.id === semanticId)
          ?.symbol,
      ).toEqual(emoji);
      result = await mutate({
        kind: "upload",
        toolId: semanticId,
        expectedVersion: result.version,
        filename: "icon.html",
        bytes: Buffer.from("<body>Icon QA</body>"),
      });
      result = await mutate({
        kind: "check",
        toolId: semanticId,
        expectedVersion: result.version,
      });
      result = await mutate({
        kind: "publish",
        toolId: semanticId,
        expectedVersion: result.version,
      });
      expect(
        (await store.catalogue(userScope)).find(
          (tool) => tool.id === semanticId,
        )?.symbol,
      ).toEqual(emoji);
      const icon = {
        kind: "icon",
        value: "palette",
        backgroundColor: "#202437",
        foregroundColor: "#FFFFFF",
      } as const;
      result = await mutate({
        kind: "update",
        toolId: semanticId,
        expectedVersion: result.version,
        presentation: { ...initial, symbol: icon },
      });
      expect((await store.usageDetail(userScope, initial.slug)).symbol).toEqual(
        icon,
      );
      await expect(
        mutate({
          kind: "update",
          toolId: semanticId,
          expectedVersion: result.version,
          presentation: { ...initial, symbol: icon, logoImageId: logoId },
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      result = await mutate({
        kind: "update",
        toolId: semanticId,
        expectedVersion: result.version,
        presentation: { ...initial, symbol: null, logoImageId: logoId },
      });
      expect((await store.detail(authority, semanticId)).tool).toMatchObject({
        symbol: null,
        logoImageId: logoId,
      });
      result = await mutate({
        kind: "availability",
        toolId: semanticId,
        expectedVersion: result.version,
        enabled: false,
      });
      await mutate({
        kind: "delete",
        toolId: semanticId,
        expectedVersion: result.version,
      });
    });

    it("creates exactly once on retry and rejects reuse with changed input", async () => {
      const command = { kind: "create", presentation } as const;
      const [first, retry] = await Promise.all([
        store.mutate(authority, "create-1", command),
        store.mutate(authority, "create-1", command),
      ]);
      expect(retry).toEqual(first);
      toolId = first.toolId;
      expect(await store.list(authority)).toHaveLength(1);
      expect(await store.catalogue(userScope)).toEqual([]);
      await expect(
        store.mutate(authority, "create-1", {
          ...command,
          presentation: { ...presentation, displayName: "Changed" },
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("requires inspection of the exact current draft before publication", async () => {
      await mutate({
        kind: "upload",
        toolId,
        expectedVersion: 1,
        filename: "calculator.html",
        bytes: Buffer.from("<body>Calculator</body>"),
      });
      await expect(
        mutate({ kind: "publish", toolId, expectedVersion: 2 }),
      ).rejects.toMatchObject({ code: "not_ready" });
      const first = await store.draft(authority, toolId);
      await mutate({ kind: "check", toolId, expectedVersion: 2 });
      await mutate({
        kind: "configure",
        toolId,
        expectedVersion: 3,
        config: {
          expectedVersion: 3,
          versionLabel: "1.0",
          releaseNotes: "Initial",
          allowedContractRevisionIds: [],
        },
      });
      await expect(
        mutate({ kind: "publish", toolId, expectedVersion: 4 }),
      ).rejects.toMatchObject({ code: "not_ready" });
      await mutate({ kind: "check", toolId, expectedVersion: 4 });
      await mutate({ kind: "publish", toolId, expectedVersion: 5 });
      const published = (await store.detail(authority, toolId)).tool;
      expect(published).toMatchObject({
        state: "enabled",
        draft: null,
        publishedRevision: { revisionNumber: 1, id: first.revision.id },
      });
      await expect(
        mutate({
          kind: "update",
          toolId,
          expectedVersion: 6,
          presentation: { ...presentation, slug: "renamed" },
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("keeps the publication intact during replacement and revokes authority on disable", async () => {
      expect(await store.catalogue(userScope)).toEqual([
        {
          id: toolId,
          slug: "calculator",
          displayName: "计算器",
          logoImageId: logoId,
          coverImageId: null,
          symbol: null,
        },
      ]);
      expect(
        Object.keys(await store.usageDetail(userScope, "calculator")).sort(),
      ).toEqual(
        [
          "id",
          "slug",
          "displayName",
          "logoImageId",
          "symbol",
          "coverImageId",
          "descriptionMarkdown",
          "publishedRevisionId",
        ].sort(),
      );
      expect((await images.readForUser(userScope, logoId)).id).toBe(logoId);
      await expect(
        images.readForUser(userScope, orphanId),
      ).rejects.toMatchObject({ code: "not_found" });
      const old = (await store.detail(authority, toolId)).tool
        .publishedRevision;
      await mutate({
        kind: "upload",
        toolId,
        expectedVersion: 6,
        filename: "replacement.html",
        bytes: Buffer.from("<body>Replacement</body>"),
      });
      const tool = (await store.detail(authority, toolId)).tool;
      expect(tool.publishedRevision).toEqual(old);
      expect(tool.draft?.digest).not.toBe(old?.digest);
      await expect(
        mutate({ kind: "update", toolId, expectedVersion: 6, presentation }),
      ).rejects.toMatchObject({ code: "conflict" });
      await mutate({
        kind: "availability",
        toolId,
        expectedVersion: 7,
        enabled: false,
      });
      expect((await store.detail(authority, toolId)).tool.state).toBe(
        "disabled",
      );
      expect(await store.catalogue(userScope)).toEqual([]);
      await expect(
        store.usageDetail(userScope, "calculator"),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(images.readForUser(userScope, logoId)).rejects.toMatchObject(
        { code: "not_found" },
      );
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT execution_epoch FROM site_tool WHERE id=?",
        [toolId],
      );
      expect(rows[0]?.execution_epoch).toBe(2);
      await mutate({
        kind: "availability",
        toolId,
        expectedVersion: 8,
        enabled: true,
      });
      expect(
        (await store.detail(authority, toolId)).tool.publishedRevision,
      ).toEqual(old);
      const [events] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM audit_event WHERE resource_type='site_tool' AND resource_id=?",
        [toolId],
      );
      expect(Number(events[0]?.total)).toBe(9);
    });

    it("pins sessions, isolates preview, and never revives old grants on re-enable", async () => {
      const actor = { kind: "use", scope: userScope } as const;
      const tool = (await store.detail(authority, toolId)).tool;
      expect(
        await store.source(authority, toolId, tool.publishedRevision!.id),
      ).toMatchObject({
        revisionId: tool.publishedRevision!.id,
        content: "<body>Calculator</body>",
      });
      expect((await store.source(authority, toolId)).revisionId).toBe(
        tool.draft!.id,
      );
      await expect(
        store.source(authority, toolId, id(999)),
      ).rejects.toMatchObject({ code: "not_found" });
      const opened = await sessions.create(
        actor,
        toolId,
        tool.publishedRevision!.id,
        "open-calculator",
      );
      expect(opened).toMatchObject({
        available: true,
        maximumRuns: 0,
        allowedContractRevisionIds: [],
      });
      expect(
        await sessions.create(
          actor,
          toolId,
          tool.publishedRevision!.id,
          "open-calculator",
        ),
      ).toEqual(opened);
      await expect(
        sessions.get(
          {
            kind: "use",
            scope: {
              ...userScope,
              authenticationRefId: "other-browser-session",
            },
          },
          opened.id,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        sessions.assertRun(actor, opened.id, id(900)),
      ).rejects.toMatchObject({ code: "not_found" });
      await mutate({ kind: "check", toolId, expectedVersion: 9 });
      const previewActor = { kind: "preview", authority } as const;
      const publishedPreview = await sessions.create(
        previewActor,
        toolId,
        tool.publishedRevision!.id,
        "preview-current-published",
      );
      expect(publishedPreview).toMatchObject({
        available: true,
        maximumRuns: 0,
        allowedContractRevisionIds: [],
      });
      expect(
        (await sessions.document(previewActor, publishedPreview.id)).toString(),
      ).toBe("<body>Calculator</body>");
      const preview = await sessions.create(
        previewActor,
        toolId,
        tool.draft!.id,
        "preview-replacement",
      );
      expect(preview).toMatchObject({
        kind: "preview",
        maximumRuns: 0,
        allowedContractRevisionIds: [],
      });
      await expect(sessions.get(actor, preview.id)).rejects.toMatchObject({
        code: "not_found",
      });
      await mutate({ kind: "publish", toolId, expectedVersion: 10 });
      expect((await store.source(authority, toolId)).revisionId).toBe(
        tool.draft!.id,
      );
      await expect(
        store.source(authority, toolId, tool.publishedRevision!.id),
      ).rejects.toMatchObject({ code: "not_found" });
      expect((await sessions.document(actor, opened.id)).toString()).toBe(
        "<body>Calculator</body>",
      );
      expect((await sessions.get(previewActor, preview.id)).available).toBe(
        true,
      );
      expect(
        (await sessions.get(previewActor, publishedPreview.id)).available,
      ).toBe(false);
      await expect(
        sessions.create(
          previewActor,
          toolId,
          tool.publishedRevision!.id,
          "preview-old-published",
        ),
      ).rejects.toMatchObject({ code: "conflict" });
      await mutate({
        kind: "availability",
        toolId,
        expectedVersion: 11,
        enabled: false,
      });
      expect((await sessions.get(actor, opened.id)).available).toBe(false);
      await expect(sessions.document(actor, opened.id)).rejects.toMatchObject({
        code: "not_ready",
      });
      await mutate({
        kind: "availability",
        toolId,
        expectedVersion: 12,
        enabled: true,
      });
      expect((await sessions.get(actor, opened.id)).available).toBe(false);
      const latest = (await store.detail(authority, toolId)).tool
        .publishedRevision!;
      const fresh = await sessions.create(
        actor,
        toolId,
        latest.id,
        "open-latest",
      );
      expect((await sessions.document(actor, fresh.id)).toString()).toBe(
        "<body>Replacement</body>",
      );
      const later = createToolSessionStore(
        pool,
        authority.instanceId,
        () => new Date(now.getTime() + 61 * 60000),
      );
      expect(await later.get(actor, fresh.id)).toMatchObject({
        available: false,
        unavailableReason: "expired",
      });
      await expect(later.document(actor, fresh.id)).rejects.toMatchObject({
        code: "not_ready",
      });
      expect(await sessions.close(actor, fresh.id)).toMatchObject({
        available: false,
        unavailableReason: "closed",
      });
    });

    it("rechecks live Workspace membership for catalogue and bookmarked use", async () => {
      await pool.execute(
        "UPDATE workspace_membership SET status='revoked', version=2 WHERE id=?",
        [id(12)],
      );
      await expect(images.readForUser(userScope, logoId)).rejects.toMatchObject(
        { code: "authorization.scope_stale" },
      );
      await expect(store.catalogue(userScope)).rejects.toMatchObject({
        code: "authorization.scope_stale",
      });
      await expect(
        store.usageDetail(userScope, "calculator"),
      ).rejects.toMatchObject({ code: "authorization.scope_stale" });
    });

    it("discards only the candidate and keeps the published source", async () => {
      const before = (await store.detail(authority, toolId)).tool;
      const uploaded = await mutate({
        kind: "upload",
        toolId,
        expectedVersion: before.version,
        filename: "edited.html",
        bytes: Buffer.from("<body>Unpublished edit</body>"),
      });
      const draft = await store.source(authority, toolId);
      expect(draft.content).toBe("<body>Unpublished edit</body>");
      await mutate({
        kind: "discard",
        toolId,
        expectedVersion: uploaded.version,
      });
      const after = (await store.detail(authority, toolId)).tool;
      expect(after.draft).toBeNull();
      expect(after.publishedRevision).toEqual(before.publishedRevision);
      expect((await store.source(authority, toolId)).revisionId).toBe(
        before.publishedRevision!.id,
      );
      await expect(
        store.source(authority, toolId, draft.revisionId),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("deletes disabled tools idempotently without deleting revision references", async () => {
      const tool = (await store.detail(authority, toolId)).tool;
      const enabled = await mutate({
        kind: "availability",
        toolId,
        expectedVersion: tool.version,
        enabled: true,
      });
      await expect(
        mutate({ kind: "delete", toolId, expectedVersion: enabled.version }),
      ).rejects.toMatchObject({ code: "conflict" });
      const disabled = await mutate({
        kind: "availability",
        toolId,
        expectedVersion: enabled.version,
        enabled: false,
      });
      const actor = { kind: "preview", authority } as const;
      const preview = await sessions.create(
        actor,
        toolId,
        tool.publishedRevision!.id,
        "delete-preview",
      );
      const command = {
        kind: "delete",
        toolId,
        expectedVersion: disabled.version,
      } as const;
      await expect(
        store.mutate(authority, "delete-stale", {
          ...command,
          expectedVersion: disabled.version - 1,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      const deleted = await store.mutate(authority, "delete-once", command);
      expect(await store.mutate(authority, "delete-once", command)).toEqual(
        deleted,
      );
      expect(
        (await store.list(authority)).some((item) => item.id === toolId),
      ).toBe(false);
      await expect(store.detail(authority, toolId)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(store.source(authority, toolId)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(
        sessions.create(
          actor,
          toolId,
          tool.publishedRevision!.id,
          "deleted-new-preview",
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(await sessions.get(actor, preview.id)).toMatchObject({
        available: false,
        unavailableReason: "deleted",
      });
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM site_tool_revision WHERE id=?",
        [tool.publishedRevision!.id],
      );
      expect(rows).toHaveLength(1);
    });

    it("rejects non-admin, mismatched site and revoked administrators even for replay", async () => {
      const ordinary = { ...authority, principalId: id(2), authorityId: id(2) };
      await expect(store.source(ordinary, toolId)).rejects.toMatchObject({
        code: "instance_access.forbidden",
      });
      await expect(store.list(ordinary)).rejects.toMatchObject({
        code: "instance_access.forbidden",
      });
      await expect(
        store.detail({ ...authority, instanceId: "different-site" }, toolId),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });
      await pool.execute(
        "UPDATE instance_administrator SET status='revoked', version=2 WHERE principal_id=?",
        [id(1)],
      );
      await expect(
        store.mutate(authority, "create-1", { kind: "create", presentation }),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });
      await expect(store.source(authority, toolId)).rejects.toMatchObject({
        code: "instance_access.forbidden",
      });
      await expect(store.detail(authority, toolId)).rejects.toMatchObject({
        code: "instance_access.forbidden",
      });
    });
  },
);
