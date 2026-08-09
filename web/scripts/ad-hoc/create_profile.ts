import { updateProfile, arkanCreate } from "../../lib/arkan/memory-gateway";

async function main() {
  console.log("=== Creating Profile Base ===");
  
  const profilePatch = {
    name: "Vitor",
    preferred_name: "Vittu",
    language: "pt-BR",
    conversation_style: "natural, direto, objetivo e crítico quando necessário",
    preferences: [
      "respostas práticas e objetivas",
      "não concordar automaticamente com ideias ruins",
      "evitar overengineering",
      "trabalhar em pequenas etapas funcionais"
    ]
  };

  const profileRes = await updateProfile(profilePatch, "script-session", "call-profile-base");
  console.log("Profile Base result:", profileRes);

  console.log("\n=== Creating Pinned Essential Context ===");
  const contextContent = `Vittu trabalha na Aliança Motos Avelloz principalmente com vendas, marketing e processos comerciais.

Tem forte interesse em empreendedorismo, tecnologia, inteligência artificial, automação, marketing, vendas e motocicletas.

Seus principais projetos incluem Arkan Vault, Hermes, Loopin TV e Sentinela IA.

Costuma desenvolver iterativamente com agentes de IA: ideia → implementação → teste real → correção.`;

  const contextRes = await arkanCreate(
    {
      title: "Hermes — Contexto Essencial do Vittu",
      content: contextContent,
      project: "hermes-profile",
      tags: ["always-context", "profile-context"]
    },
    "script-session",
    "call-profile-context"
  );
  
  console.log("Pinned Context result:", contextRes);
}

main().catch(console.error);
