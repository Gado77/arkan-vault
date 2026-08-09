import test from "node:test";
import assert from "node:assert";
import { arkanCreate, arkanUpdate, prepareDelete, commitDelete } from "../../lib/arkan/memory-gateway";
import { confirmDeleteAction } from "../../lib/arkan/memory-state";

test("Memory Gateway - Timeout Reconciliations", async (t) => {
  const originalFetch = global.fetch;

  await t.test("create timeout -> outcome_unknown, does not retry POST on identical callId", async () => {
    let postCalls = 0;
    global.fetch = async (url: any, options: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("openapi.json")) return { ok: true, json: async () => ({ paths: {} }) } as any;
      if (options?.method === "POST") {
        postCalls++;
        const err = new Error("Fetch timeout");
        err.name = "TimeoutError";
        throw err;
      }
      return { ok: false } as any;
    };

    const session = "sess_to_1";
    const callId = "call_to_1";

    const res1 = await arkanCreate({ title: "To Test" }, session, callId);
    assert.strictEqual(res1.ok, false);
    assert.strictEqual(res1.error?.code, "mutation_outcome_unknown");
    assert.strictEqual(postCalls, 1);

    const res2 = await arkanCreate({ title: "To Test" }, session, callId);
    assert.strictEqual(res2.ok, false);
    assert.strictEqual(res2.error?.code, "mutation_outcome_unknown");
    assert.strictEqual(postCalls, 1, "Should not retry POST");
  });

  await t.test("update timeout + GET post-condition correct -> recoveredAfterTimeout=true", async () => {
    let getCalls = 0;
    global.fetch = async (url: any, options: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("openapi.json")) return { ok: true, json: async () => ({ paths: { "/api/v1/memories/{id}": { patch: {} } } }) } as any;
      
      if (options?.method === "PATCH") {
        const err = new Error("Fetch timeout");
        err.name = "TimeoutError";
        throw err;
      }
      if (options?.method === undefined || options?.method === "GET") {
        getCalls++;
        return { ok: true, json: async () => ({ id: "mem_to_upd", title: "Updated Title" }) } as any;
      }
      return { ok: false } as any;
    };

    const session = "sess_to_2";
    const callId = "call_to_2";

    const res = await arkanUpdate("mem_to_upd", { title: "Updated Title" }, session, callId);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data?.recoveredAfterTimeout, true);
  });

  await t.test("delete timeout + GET posterior 404 -> recoveredAfterTimeout=true", async () => {
    let getCalls = 0;
    global.fetch = async (url: any, options: any) => {
      const urlStr = url.toString();
      if (options?.method === "DELETE") {
        const err = new Error("Fetch timeout");
        err.name = "TimeoutError";
        throw err;
      }
      if (options?.method === undefined || options?.method === "GET") {
        getCalls++;
        if (getCalls === 1) { // initial check during prepareDelete
          return { ok: true, json: async () => ({ id: "mem_to_del", title: "Title" }) } as any;
        }
        // subsequent checks (reconciliation)
        return { ok: false, status: 404 } as any;
      }
      return { ok: false } as any;
    };

    const session = "sess_to_3";
    const callId = "call_to_3";

    const prep = await prepareDelete("mem_to_del", session);
    confirmDeleteAction({ actionId: prep.data.action_id, logicalSessionId: session, confirmed: true });

    const commit = await commitDelete(prep.data.action_id, session, callId);
    assert.strictEqual(commit.ok, true);
    assert.strictEqual(commit.data?.recoveredAfterTimeout, true);
  });

  global.fetch = originalFetch;
});
