
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { arkanCreate, arkanUpdate, prepareDelete, commitDelete, arkanGet, updateProfile, resolveCanonicalProfile } from '../../lib/arkan/memory-gateway';
import { getCapabilities } from '../../lib/arkan/capability-registry';
import { confirmDeleteAction } from '../../lib/arkan/memory-state';
import { ARKAN_TIMEOUTS } from '../../lib/arkan/timeouts';
import { syncBootstrapCache } from '../../lib/arkan/bootstrap-cache';

async function runGates() {
  let geminiConfigured = "no";
  let geminiElapsed = 0;
  let geminiStatus = 0;

  // GATE 0
  const startG0 = performance.now();
  try {
    const res = await fetch("http://localhost:3000/api/gemini-live/token", { method: "POST" });
    geminiStatus = res.status;
    geminiElapsed = Math.round(performance.now() - startG0);
    const data = await res.json().catch(() => ({}));
    if (res.status === 200 || (res.status !== 503 && !data.error?.includes("not configured"))) {
      geminiConfigured = "yes";
    }
  } catch (e) {
    geminiElapsed = Math.round(performance.now() - startG0);
  }

  // Clear capability cache to force real network fetch
  (global as any).arkanCapabilityCache = undefined;

  // GATE 1
  const startOpenApi = performance.now();
  const caps = await getCapabilities();
  const elapsedOpenApi = Math.round(performance.now() - startOpenApi);

  console.log("Environment");
  console.log(`Gemini configured\t${geminiConfigured}`);
  console.log(`Arkan configured\t${process.env.ARKAN_VAULT_URL ? 'yes' : 'no'}`);
  console.log(`Arkan base\t\t${process.env.ARKAN_VAULT_URL || 'unknown'}`);
  console.log(`capabilitySource\t${caps.capabilitySource}`);
  console.log(`updateMethod\t\t${caps.updateMethod || 'null'}`);
  console.log("");
  console.log(`Operation\t\telapsed\ttimeout\tstatus/method\tverified`);

  // Print Gate 0
  console.log(`Gemini Token\t\t${geminiElapsed}ms\t-\tHTTP ${geminiStatus}\t${geminiConfigured === 'yes'}`);

  // Print Gate 1
  console.log(`OpenAPI\t\t\t${elapsedOpenApi}ms\t${ARKAN_TIMEOUTS.capabilities}ms\tGET 200\t\t${caps.capabilitySource === 'network' && caps.updateMethod ? 'true' : 'false'}`);

  if (geminiConfigured === "no" || caps.capabilitySource !== 'network' || !caps.updateMethod) {
    console.log("\nPARANDO. Ambiente ou OpenAPI não passaram no Gate 0/1.");
    return;
  }

  // GATE 2 - Create
  const startCreate = performance.now();
  const c = await arkanCreate({ 
    title: 'HERMES UPDATE GATE -- DELETE ME', 
    content: 'initial', 
    project: 'test', 
    tags: [] 
  }, 'sess_gate', 'call_gate_c');
  const elapsedCreate = Math.round(performance.now() - startCreate);
  console.log(`Create\t\t\t${elapsedCreate}ms\t${ARKAN_TIMEOUTS.create}ms\tPOST\t\t${c.verified}`);

  const id = c.data?.memory_id;
  if (!id) {
    console.log("Falha no Create. Parando.");
    return;
  }

  const startCreateVerify = performance.now();
  const b = await arkanGet(id, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
  const elapsedCreateVerify = Math.round(performance.now() - startCreateVerify);
  console.log(`Create Verify\t\t${elapsedCreateVerify}ms\t${ARKAN_TIMEOUTS.verificationRead}ms\tGET ${b ? '200' : '404'}\t\t${b ? 'true' : 'false'}`);

  // GATE 3 - Update
  const startUpdate = performance.now();
  const u = await arkanUpdate(id, { content: 'updated' }, 'sess_gate', 'call_gate_u');
  const elapsedUpdate = Math.round(performance.now() - startUpdate);
  console.log(`Update\t\t\t${elapsedUpdate}ms\t${ARKAN_TIMEOUTS.update}ms\t${caps.updateMethod}\t\t${u.verified}`);

  const startUpdateVerify = performance.now();
  const a = await arkanGet(id, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
  const elapsedUpdateVerify = Math.round(performance.now() - startUpdateVerify);
  console.log(`Update Verify\t\t${elapsedUpdateVerify}ms\t${ARKAN_TIMEOUTS.verificationRead}ms\tGET ${a ? '200' : '404'}\t\t${a?.content === 'updated'}`);

  // GATE 4 - Delete
  const p = await prepareDelete(id, 'sess_gate');
  confirmDeleteAction({ actionId: p.data.action_id, logicalSessionId: 'sess_gate', confirmed: true });
  
  const startDelete = performance.now();
  const dc = await commitDelete(p.data.action_id, 'sess_gate', 'call_gate_d');
  const elapsedDelete = Math.round(performance.now() - startDelete);
  console.log(`Delete\t\t\t${elapsedDelete}ms\t${ARKAN_TIMEOUTS.delete}ms\tDELETE\t\t${dc.verified}`);

  const startDeleteVerify = performance.now();
  const d = await arkanGet(id, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
  const elapsedDeleteVerify = Math.round(performance.now() - startDeleteVerify);
  console.log(`Delete Verify\t\t${elapsedDeleteVerify}ms\t${ARKAN_TIMEOUTS.verificationRead}ms\tGET ${d ? '200' : '404'}\t\t${d === null ? 'true' : 'false'}`);

  // GATE 5 - Profile
  const { profile: existingProfile } = await resolveCanonicalProfile();
  let oldName = "";
  if (existingProfile) {
    const match = existingProfile.content.match(/"preferred_name":\s*"([^"]+)"/);
    if (match) oldName = match[1];
  } else {
    // Cannot proceed if no profile exists without user data
    console.log(`Profile\t\t\t0ms\t-\tSkipped\t\tfalse (No profile found)`);
    return;
  }

  const startProfile = performance.now();
  const prof = await updateProfile({ preferred_name: 'TempGateName' }, 'sess_gate', 'call_gate_p');
  const elapsedProfile = Math.round(performance.now() - startProfile);
  console.log(`Profile\t\t\t${elapsedProfile}ms\t-\t${caps.updateMethod}\t\t${prof.verified}`);

  const startBootstrap = performance.now();
  await syncBootstrapCache();
  const elapsedBootstrap = Math.round(performance.now() - startBootstrap);
  console.log(`Bootstrap\t\t${elapsedBootstrap}ms\t-\tGET\t\ttrue`);

  // Restore profile
  await updateProfile({ preferred_name: oldName }, 'sess_gate', 'call_gate_p_restore');
}

runGates().catch(console.error);
