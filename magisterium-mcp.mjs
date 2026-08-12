import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";

// Load the token securely
const tokenRaw = fs.readFileSync("/Users/ms/git/domovinatv/pipeline.domovina.ai/.magisterium_token", "utf-8").trim();

const server = new Server({
  name: "magisterium-mcp-a2a-bridge",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

// Define the Magisterium skills as MCP tools based on agent.json
const MAGISTERIUM_TOOLS = [
  {
    name: "catholic_qa",
    description: "Ask any question about Catholic teaching and receive a comprehensive answer with citations from Magisterial documents, Scripture, and Church Fathers.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Your question (e.g., What does the Church teach about the Real Presence?)" } }, required: ["query"] }
  },
  {
    name: "document_search",
    description: "Search across 29,000+ Catholic Magisterial documents including papal encyclicals, council decrees, catechism sections, and canon law.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Your search term" } }, required: ["query"] }
  },
  {
    name: "document_fetch",
    description: "Retrieve the full text and metadata of a specific Magisterial document by its ID (obtained from document_search).",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Document ID" } }, required: ["query"] }
  },
  {
    name: "liturgical_readings",
    description: "Get the Catholic Mass readings for any date or liturgical occasion. Supports natural language date queries.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Date or occasion (e.g., today, Easter Sunday 2026)" } }, required: ["query"] }
  },
  {
    name: "saints_of_the_day",
    description: "Get the saints and blessed commemorated on a given date from the Roman Martyrology, with biographical summaries.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Date (e.g., March 19)" } }, required: ["query"] }
  },
  {
    name: "saint_lookup",
    description: "Look up a saint, blessed, venerable, or servant of God by name or canonical ID.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Name or ID of the saint" } }, required: ["query"] }
  },
  {
    name: "person_lookup",
    description: "Look up a Catholic clergy figure (bishop, cardinal, archbishop, etc.) by name or canonical ID.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Name or ID of the person" } }, required: ["query"] }
  },
  {
    name: "pope_lookup",
    description: "Look up a pope by name or canonical ID.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Name or ID of the pope" } }, required: ["query"] }
  },
  {
    name: "diocese_lookup",
    description: "Look up an ecclesiastical jurisdiction (diocese, archdiocese, eparchy, etc.) by name or canonical source_code.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Name or ID of the diocese" } }, required: ["query"] }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: MAGISTERIUM_TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const query = request.params.arguments?.query;

  if (!MAGISTERIUM_TOOLS.find(t => t.name === toolName)) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        messageId: "req-" + Date.now(),
        kind: "message",
        parts: [{ kind: "text", text: String(query) }],
        metadata: { skillId: toolName }
      }
    }
  };

  try {
    const res = await fetch("https://www.magisterium.com/api/v1/a2a", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenRaw}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
       return {
         content: [{ type: "text", text: `Error ${res.status}: ${await res.text()}` }],
         isError: true
       };
    }

    const data = await res.json();
    
    if (data.error) {
       return {
         content: [{ type: "text", text: `A2A Error: ${JSON.stringify(data.error)}` }],
         isError: true
       };
    }
    
    // Extract the text from the response artifacts or history
    let responseText = "No response text found.";
    
    if (data.result && data.result.artifacts) {
       // Often Magisterium returns the main response in artifacts
       const art = data.result.artifacts[0];
       if (art && art.parts && art.parts[0] && art.parts[0].text) {
           responseText = art.parts[0].text;
       }
    }
    
    if (responseText === "No response text found." && data.result && data.result.history) {
       const agentMsgs = data.result.history.filter(h => h.role === "agent");
       if (agentMsgs.length > 0) {
           const lastMsg = agentMsgs[agentMsgs.length - 1];
           if (lastMsg.parts && lastMsg.parts[0] && lastMsg.parts[0].text) {
               responseText = lastMsg.parts[0].text;
           }
       }
    }

    return {
      content: [{ type: "text", text: responseText }]
    };

  } catch (err) {
    return {
      content: [{ type: "text", text: `Fetch error: ${err.message}` }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Magisterium A2A Bridge MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
