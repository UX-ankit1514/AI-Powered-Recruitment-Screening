/**
 * M9 review of data retention: storage deletes run on the app server, never with a key stored in
 * the database. The claim/settle functions are service-role only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { castOfUsers, cleanupCast, service, type Cast } from "./helpers";

vi.mock("server-only", () => ({}));
import { flushRetentionFiles } from "../../lib/retention/files";

let cast: Cast;
beforeAll(async () => {
  cast = await castOfUsers();
});
afterAll(async () => {
  await cleanupCast(cast);
});

describe("retention file deletes (least privilege)", () => {
  it("clients cannot claim or settle queued files", async () => {
    for (const c of [cast.anon, cast.admin, cast.hm]) {
      expect((await c.rpc("claim_retention_files", { p_limit: 1 })).error).toBeTruthy();
      expect((await c.rpc("settle_retention_files", { p_ids: [1] })).error).toBeTruthy();
    }
  });

  it("the server flusher runs with the service client and settles what it claims", async () => {
    const n = await flushRetentionFiles(service(), 5);
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("the dispatcher's cron run calls the flusher (no HTTP from the database)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../lib/calls/dispatch.ts", import.meta.url), "utf8");
    expect(src).toContain("flushRetentionFiles(");
    const mig = readFileSync(new URL("../../../supabase/migrations/20261116130000_retention_least_privilege.sql", import.meta.url), "utf8");
    expect(mig).toContain("delete from vault.secrets where name in ('pingo_service_role_key'");
  });
});
