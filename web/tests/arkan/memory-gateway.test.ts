import test from "node:test";
import assert from "node:assert";
import { arkanList, arkanRecall, arkanGet, arkanCreate, arkanUpdate, prepareDelete, commitDelete } from "../../lib/arkan/memory-gateway";
import { getJournalEntry, setJournalEntry, getDeleteAction, updateDeleteActionDecision } from "../../lib/arkan/memory-state";

test("Memory Gateway - READ Operations", async (t) => {
  // Mock global fetch for basic tests
  const originalFetch = global.fetch;

  await t.test("arkanList should pass through (Temporary Etapa A)", async () => {
    global.fetch = async (url: any, options: any) => {
      return {
        ok: true,
        json: async () => [{ id: "mem1", content: "Test memory" }]
      } as any;
    };

    const results = await arkanList({ limit: 10 });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, "mem1");
  });

  await t.test("arkanCreate should verify post-condition and be idempotent", async () => {
    let postCalls = 0;
    let getCalls = 0;

    global.fetch = async (url: any, options: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("openapi.json")) {
         return {
           ok: true,
           json: async () => ({
             paths: {
               "/api/v1/memories": { get: {}, post: {} },
               "/api/v1/memories/{id}": { get: {}, patch: {}, delete: {} },
               "/api/v1/memories/search": { get: {} }
             }
           })
         } as any;
      }
      if (options?.method === "POST") {
        postCalls++;
        return { ok: true, json: async () => ({ id: "mem_created" }) } as any;
      }
      if (options?.method === undefined || options?.method === "GET") {
        // GET memory
        getCalls++;
        return { ok: true, json: async () => ({ id: "mem_created", title: "Test Title", content: "..." }) } as any;
      }
      return { ok: false } as any;
    };

    const session = "sess_1";
    const callId = "call_1";

    const res1 = await arkanCreate({ title: "Test Title", content: "..." }, session, callId);
    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res1.verified, true);
    assert.strictEqual(res1.data?.memory_id, "mem_created");
    assert.strictEqual(postCalls, 1);
    assert.strictEqual(getCalls, 1);

    // Idempotency: second call with same session/callId should return cached result immediately
    const res2 = await arkanCreate({ title: "Test Title", content: "..." }, session, callId);
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(postCalls, 1, "Should not call POST again");
    assert.strictEqual(getCalls, 1, "Should not call GET again");
  });

  await t.test("arkanUpdate should verify post-condition and be idempotent", async () => {
    let patchCalls = 0;
    let getCalls = 0;

    global.fetch = async (url: any, options: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("openapi.json")) {
         return {
           ok: true,
           json: async () => ({ paths: { "/api/v1/memories/{id}": { get: {}, patch: {}, delete: {} } } })
         } as any;
      }
      if (options?.method === "PATCH") {
        patchCalls++;
        return { ok: true, json: async () => ({}) } as any;
      }
      if (options?.method === undefined || options?.method === "GET") {
        getCalls++;
        return { ok: true, json: async () => ({ id: "mem1", title: "Updated Title" }) } as any;
      }
      return { ok: false } as any;
    };

    const session = "sess_2";
    const callId = "call_2";

    const res1 = await arkanUpdate("mem1", { title: "Updated Title" }, session, callId);
    assert.strictEqual(res1.ok, true);
    assert.strictEqual(res1.verified, true);
    assert.strictEqual(patchCalls, 1);
    assert.strictEqual(getCalls, 1);

    // Idempotency: second call
    const res2 = await arkanUpdate("mem1", { title: "Updated Title" }, session, callId);
    assert.strictEqual(res2.ok, true);
    assert.strictEqual(patchCalls, 1, "Should not call PATCH again");
    assert.strictEqual(getCalls, 1, "Should not call GET again");
  });

  await t.test("Two-Phase Delete should prepare, confirm, and commit successfully", async () => {
    let deleteCalls = 0;
    
    global.fetch = async (url: any, options: any) => {
      if (options?.method === "DELETE") {
        deleteCalls++;
        return { ok: true, json: async () => ({}) } as any;
      }
      if (options?.method === undefined || options?.method === "GET") {
        // Return memory on prepare, but return 404 on commit to simulate deletion
        if (deleteCalls > 0) return { ok: false, status: 404 } as any;
        return { ok: true, json: async () => ({ id: "mem_to_delete", title: "Test Title" }) } as any;
      }
      return { ok: false } as any;
    };

    const session = "sess_delete";
    const callId = "call_delete";

    const prep = await prepareDelete("mem_to_delete", session);
    assert.strictEqual(prep.ok, false); // Prepare is not a commit
    assert.strictEqual(prep.data?.confirmation_required, true);
    assert.strictEqual(typeof prep.data?.action_id, "string");
    const actionId = prep.data.action_id;

    // Simulate confirmation via confirm-delete route
    const confirmed = updateDeleteActionDecision(actionId, "confirmed");
    assert.strictEqual(confirmed, true);

    const commit = await commitDelete(actionId, session, callId);
    assert.strictEqual(commit.ok, true);
    assert.strictEqual(commit.verified, true);
    assert.strictEqual(deleteCalls, 1);
  });

  // Restore fetch
  global.fetch = originalFetch;
});
