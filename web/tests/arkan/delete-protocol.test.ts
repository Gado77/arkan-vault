import test from "node:test";
import assert from "node:assert/strict";

test("Delete Protocol: Transcript Evaluation Regex", async (t) => {
  const isRejection = (text: string) => /(não|deixa|cancela|não apaga|melhor não|sim, mas não apaga)/i.test(text);
  const isConfirmation = (text: string) => /(sim|pode apagar|eu confirmo|confirmo|pode deletar|é essa mesmo|sim, essa mesmo|sim, pode apagar|apaga)/i.test(text);

  await t.test("Rejects 'sim, mas não apaga'", () => {
    assert.ok(isRejection("sim, mas não apaga"));
    assert.equal(isConfirmation("sim, mas não apaga"), true); 
    // Wait, since both match "sim", the code checks isRejection FIRST.
    // If isRejection is true, it cancels, ignoring isConfirmation.
  });

  await t.test("Rejects 'não'", () => {
    assert.ok(isRejection("não"));
    assert.ok(isRejection("não apaga"));
    assert.ok(isRejection("cancela"));
    assert.ok(isRejection("melhor não"));
  });

  await t.test("Confirms 'sim'", () => {
    assert.equal(isRejection("sim"), false);
    assert.ok(isConfirmation("sim"));
    assert.ok(isConfirmation("pode apagar"));
    assert.ok(isConfirmation("eu confirmo"));
    assert.ok(isConfirmation("confirmo"));
  });
});

test("Delete Protocol: Global State API Race Condition", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async (url: any, options: any) => {
    return { ok: true, json: async () => ({ id: "mem_fake_race", title: "Test Memory" }) } as any;
  };
  
  t.after(() => {
    global.fetch = originalFetch;
  });

  const { POST: executePOST } = await import("../../app/api/live-tools/execute/route");
  const { POST: confirmPOST } = await import("../../app/api/live-tools/confirm-delete/route");
  const { getDeleteAction } = await import("../../lib/arkan/memory-state");

  const sessionId = crypto.randomUUID();

  // 1. Prepare
  const req1 = new Request("http://localhost/api/live-tools/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      callId: "call_1",
      name: "arkan_delete",
      args: { memory_id: "mem_fake_race" }
    })
  });

  const res1 = await executePOST(req1 as any);
  const data1 = await res1.json() as any;
  assert.equal(res1.status, 200);
  assert.equal(data1.operation, "delete_prepare");
  
  const actionId = data1.data.action_id;
  assert.ok(actionId);

  // 2. Action is pending
  let action = getDeleteAction(actionId);
  assert.equal(action?.decision, "pending");

  // 3. User says "sim, mas não apaga" -> Confirm false
  const req2 = new Request("http://localhost/api/live-tools/confirm-delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      actionId,
      confirmed: false
    })
  });
  
  const res2 = await confirmPOST(req2 as any);
  const data2 = await res2.json() as any;
  assert.equal(data2.ok, true);

  // 4. Action should be gone (cancelled)
  action = getDeleteAction(actionId);
  assert.equal(action, null);

  // 5. Commit attempt should fail gracefully
  const req3 = new Request("http://localhost/api/live-tools/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      callId: "call_2",
      name: "arkan_delete_commit",
      args: { action_id: actionId }
    })
  });
  
  const res3 = await executePOST(req3 as any);
  const data3 = await res3.json() as any;
  // It hits the backend which says action not found -> memory_unavailable
  assert.equal(data3.ok, false);
});
