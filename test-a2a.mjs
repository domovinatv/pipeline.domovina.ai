import fs from 'fs';

async function testA2A() {
  const tokenRaw = fs.readFileSync('.magisterium_token', 'utf-8').trim();
  // Ensure token is clean. Sometimes cookie value is URI encoded or has surrounding quotes.
  let tokenStr = decodeURIComponent(tokenRaw);
  if (tokenStr.startsWith('"') && tokenStr.endsWith('"')) {
      tokenStr = tokenStr.slice(1, -1);
  }
  // If it's a supabase JSON cookie, extract the access_token
  try {
      const parsed = JSON.parse(tokenStr);
      if (parsed.access_token) tokenStr = parsed.access_token;
  } catch(e) {}
  
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        messageId: "test-" + Date.now(),
        kind: "message",
        parts: [{ kind: "text", text: "What is the capital of France?" }],
        metadata: { skillId: "catholic_qa" }
      }
    }
  };

  const res = await fetch("https://www.magisterium.com/api/v1/a2a", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenStr}`
    },
    body: JSON.stringify(payload)
  });

  console.log("Status:", res.status);
  const data = await res.text();
  console.log("Response:", data);
}

testA2A().catch(console.error);
