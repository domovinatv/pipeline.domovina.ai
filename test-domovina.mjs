import fs from "fs";

async function testInit() {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" }
    }
  };

  const res = await fetch("https://mcp.domovina.ai/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer 8cf9fefe31f5ed94416f10b0dac6e93d7bfe54efa10b227461ec6c6aae978066"
    },
    body: JSON.stringify(payload)
  });

  console.log("Status:", res.status);
  console.log("Headers:");
  res.headers.forEach((v, k) => console.log(k, ":", v));
  console.log("\nBody:");
  const text = await res.text();
  console.log(text);
}

testInit().catch(console.error);
