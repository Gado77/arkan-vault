async function run() {
  const req = await fetch('http://localhost:3000/api/live-tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: '11111111-2222-3333-4444-555555555555',
      callId: 'test_call_get',
      name: 'arkan_get',
      args: { memory_id: 'mem_af8dac24dbc64fdf89a931162da19db9' }
    })
  });
  const data = await req.json();
  console.log(data);
}
run();
