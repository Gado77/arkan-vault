import { arkanUpdate, arkanCreate, arkanList } from "../../lib/arkan/memory-gateway";
import fs from "fs";
import path from "path";

async function main() {
  const agentsMdPath = path.resolve(process.cwd(), "../.agents/AGENTS.md");
  const agentsContent = fs.readFileSync(agentsMdPath, "utf-8");

  console.log("=== Finding Hermes Architecture Memory ===");
  const list = await arkanList({ project: "hermes-profile" });
  const memory = list.find((m: any) => m.title && m.title.includes("Hermes agente arquitetura"));

  if (memory) {
    console.log(`Found memory with ID: ${memory.id}. Updating...`);
    const updateRes = await arkanUpdate(memory.id, { content: agentsContent }, "script-session", "call-update-memory");
    console.log("Memory Update result:", updateRes);
  } else {
    console.log("Memory not found. Creating...");
    const createRes = await arkanCreate({
      title: "Hermes agente arquitetura funcionamento e integração com Arkan Vault",
      content: agentsContent,
      project: "hermes-profile",
      tags: ["always-context", "architecture"]
    }, "script-session", "call-create-memory");
    console.log("Memory Create result:", createRes);
  }
}

main().catch(console.error);
