import { request } from 'http';

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        hostname: 'localhost',
        port: 3000,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) });
          } catch (e) {
            resolve({ status: res.statusCode, raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTest() {
  console.log("--- 0) POST arkan_remember ---");
  const res0 = await post('/api/live-tools/execute', {
    sessionId: "11111111-2222-3333-4444-555555555555",
    callId: "test_call_0",
    name: "arkan_remember",
    args: { title: "Test Memory", content: "This is a test memory for global state." }
  });
  console.log("Status:", res0.status, "Data:", res0.data);
  const memoryId = res0.data?.id;
  if (!memoryId) return console.error("No memoryId created!");

  console.log("\n--- A) POST arkan_delete ---");
  const resA = await post('/api/live-tools/execute', {
    sessionId: "11111111-2222-3333-4444-555555555555",
    callId: "test_call_1",
    name: "arkan_delete",
    args: { memory_id: memoryId }
  });
  console.log("Status:", resA.status, "Data:", resA.data);

  const actionId = resA.data?.data?.action_id;
  if (!actionId) {
    console.error("No actionId returned!");
    return;
  }

  console.log("\n--- B) POST confirm-delete ---");
  const resB = await post('/api/live-tools/confirm-delete', {
    sessionId: "11111111-2222-3333-4444-555555555555",
    actionId: actionId,
    confirmed: true
  });
  console.log("Status:", resB.status, "Data:", resB.data);
  
  console.log("\n--- C) POST arkan_delete_commit ---");
  const resC = await post('/api/live-tools/execute', {
    sessionId: "11111111-2222-3333-4444-555555555555",
    callId: "test_call_2",
    name: "arkan_delete_commit",
    args: { action_id: actionId }
  });
  console.log("Status:", resC.status, "Data:", resC.data);
}

runTest().catch(console.error);
