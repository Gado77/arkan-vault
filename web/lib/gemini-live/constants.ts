/**
 * lib/gemini-live/constants.ts
 *
 * Shared constants for the Gemini Live engine.
 */

/** WebSocket endpoint for ephemeral-token (constrained) sessions. */
export const GEMINI_LIVE_WS =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

/** Time in milliseconds of silence/inactivity before the session is automatically closed. */
export const VOICE_IDLE_TIMEOUT_MS = 10000;

/** System instruction for Hermes voice identity (with Arkan memory rules). */
export const HERMES_SYSTEM_INSTRUCTION = `Você é Hermes, um assistente pessoal de voz.

Converse sempre em português brasileiro de maneira natural, direta e breve.

Você tem acesso à memória persistente do usuário através da ferramenta arkan_recall.

Use memória somente quando a resposta depender de fatos pessoais, conversas anteriores, preferências, projetos, decisões ou informações que o usuário já tenha fornecido.

Nunca invente uma memória. Se a memória necessária não estiver disponível, diga isso naturalmente.

Use arkan_remember somente quando o usuário pedir explicitamente que alguma informação seja lembrada, salva, guardada ou registrada.

Para perguntas gerais que não dependam da memória do usuário, responda sem consultar o Arkan.

Quando o usuário indicar claramente que terminou e não precisa de mais ajuda, não pergunte se pode ajudar em mais alguma coisa. Chame hermes_end_conversation.

O contexto em <arkan_profile_context> contém fatos persistentes previamente armazenados sobre o usuário e preferências do assistente. Use-os naturalmente quando relevantes.
Não diga que precisou consultar a memória para fatos presentes nesse contexto.
Para informações não presentes nele, use as ferramentas Arkan quando necessário.
Nunca invente uma memória que não foi retornada pelo Arkan.

Se você precisar alterar permanentemente como você chama o usuário, o idioma, ou o seu estilo de conversa, use a ferramenta arkan_profile_update.
Se você receber uma tag <arkan_profile_update> (via tool response ou mensagem interna), atualize seu contexto silenciosamente.

Importante sobre Mutações: Só confirme ao usuário que uma memória foi atualizada, deletada ou salva SE o resultado da tool retornar ok=true E verified=true.
Fluxo de Exclusão (2 fases):
1. Quando o usuário pedir para apagar, chame arkan_delete(memory_id). O gateway retornará um action_id e confirmation_required=true.
2. O usuário confirmará ou rejeitará por voz, e o sistema processará isso internamente. Se a exclusão for confirmada, você será notificado para efetivá-la.
3. Para efetivar, você DEVE chamar arkan_delete_commit(action_id). SÓ ENTÃO a exclusão é real (se ok=true e verified=true).

Não descreva internamente ferramentas, JSON, IDs de memória ou detalhes técnicos ao usuário, salvo se ele perguntar.`;

/** Local command patterns detected via input transcription. */
export const CMD_SLEEP = /hermes[,.]?\s*(dormir|desligar|desliga)/i;
export const CMD_STOP = /hermes[,.]?\s*(pare|para|cancelar|cancela)/i;
export const CMD_MIC_OFF = /hermes[,.]?\s*desligue.*microfone/i;
export const CMD_HARD_MIC_OFF = /hermes[,.]?\s*desligue\s+completamente\s+.*microfone/i;
export const CMD_END_NATURAL = /era s[óo] isso|j[áa] resolveu|n[ãa]o preciso de mais nada/i;

export const ARKAN_TOOL_DECLARATIONS = [
  {
    name: "arkan_recall",
    description:
      "Busca memórias persistentes do usuário no Arkan Vault. Use apenas quando a resposta depender de informações pessoais, histórico, preferências, projetos ou decisões anteriores do usuário.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "Texto de busca semântica — descreva o que precisa encontrar.",
        },
        limit: {
          type: "INTEGER",
          description: "Número máximo de resultados (padrão: 4, máximo: 5).",
        },
        project: {
          type: "STRING",
          description: "Filtra memórias de um projeto específico (opcional).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "arkan_remember",
    description:
      "Salva uma informação na memória persistente do usuário no Arkan Vault. Use somente quando o usuário pedir explicitamente para lembrar, guardar, registrar ou salvar alguma informação.",
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "Título curto e descritivo da memória.",
        },
        content: {
          type: "STRING",
          description: "Conteúdo completo em linguagem natural.",
        },
        project: {
          type: "STRING",
          description: "Projeto ao qual esta memória pertence (opcional).",
        },
        tags: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Tags para categorização (opcional).",
        },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "arkan_get",
    description: "Obtém uma memória exata pelo seu ID.",
    parameters: {
      type: "OBJECT",
      properties: {
        memory_id: { type: "STRING", description: "ID exato da memória." }
      },
      required: ["memory_id"]
    }
  },
  {
    name: "arkan_delete",
    description: "Apaga uma memória. Retorna um action_id se precisar de confirmação humana. Você NÃO PRECISA pedir confirmação antes de chamar a tool, apenas chame e veja se o gateway exige.",
    parameters: {
      type: "OBJECT",
      properties: {
        memory_id: { type: "STRING" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "arkan_delete_commit",
    description: "Executa a deleção de uma memória que já foi confirmada pelo usuário. Use o action_id recebido da tool arkan_delete.",
    parameters: {
      type: "OBJECT",
      properties: {
        action_id: { type: "STRING", description: "O action_id recebido anteriormente da tool arkan_delete" },
      },
      required: ["action_id"],
    },
  },
  {
    name: "arkan_list",
    description: "Lista memórias aplicando filtros exatos. Útil para perguntas como 'O que existe no Arkan?' ou 'Quais memórias tenho do projeto X?'.",
    parameters: {
      type: "OBJECT",
      properties: {
        project: { type: "STRING", description: "Filtra por projeto." },
        type: { type: "STRING", description: "Filtra por tipo de memória." },
        tags: { type: "ARRAY", items: { type: "STRING" }, description: "Lista de tags." },
        limit: { type: "INTEGER", description: "Limite de resultados." }
      }
    }
  },
  {
    name: "arkan_update",
    description: "Atualiza uma memória existente. Apenas os campos fornecidos em patch serão alterados.",
    parameters: {
      type: "OBJECT",
      properties: {
        memory_id: { type: "STRING", description: "ID da memória a atualizar." },
        patch: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING" },
            summary: { type: "STRING" },
            content: { type: "STRING" },
            project: { type: "STRING" },
            tags: { type: "ARRAY", items: { type: "STRING" } }
          }
        }
      },
      required: ["memory_id", "patch"]
    }
  },

  {
    name: "arkan_profile_update",
    description: "Altera ou cria as configurações persistentes do perfil base (nome do usuário, idioma, estilo). Use isto quando o usuário disser 'me chame de X' ou 'mude seu estilo para Y'.",
    parameters: {
      type: "OBJECT",
      properties: {
        patch: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nome real do usuário." },
            preferred_name: { type: "STRING", description: "Como o usuário prefere ser chamado." },
            language: { type: "STRING", description: "Idioma principal de resposta." },
            conversation_style: { type: "STRING", description: "Estilo de conversa (ex: direto, formal)." },
            preferences: { type: "ARRAY", items: { type: "STRING" }, description: "Lista de preferências gerais." }
          }
        }
      },
      required: ["patch"]
    }
  }
];

export const LOCAL_TOOL_DECLARATIONS = [
  {
    name: "hermes_end_conversation",
    description:
      "O usuário indicou claramente que terminou a interação e não precisa de mais ajuda. Use somente quando a intenção de encerrar a conversa for inequívoca.",
    parameters: {
      type: "OBJECT",
      properties: {
        reason: {
          type: "STRING",
          description: "Motivo do encerramento (ex: user_done).",
        },
      },
    },
  }
];

export const LIVE_TOOL_DECLARATIONS = {
  functionDeclarations: [
    ...ARKAN_TOOL_DECLARATIONS,
    ...LOCAL_TOOL_DECLARATIONS
  ]
};
