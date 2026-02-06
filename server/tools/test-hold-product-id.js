/**
 * Test hold con productId numérico (1,2,3) - verifica mapeo a cake_choco_8
 */
const BASE = 'http://localhost:3000';

async function testHold() {
  const slotStartAt = '2026-02-07T14:00:00-04:00';
  const items = [{ productId: '1', qty: 1 }];
  const res = await fetch(`${BASE}/api/reservations/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slotStartAt,
      items,
      customer: { name: 'Test', email: 'test@test.com', phone: '8095550000' }
    })
  });
  const data = await res.json().catch(() => ({}));
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(data, null, 2));
  return res.ok;
}

testHold().then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
