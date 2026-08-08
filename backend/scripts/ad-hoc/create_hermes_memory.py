import sys
from pathlib import Path

# Add backend to sys.path
backend_path = Path("c:/Users/itach/Documents/arkan-vault/backend")
sys.path.insert(0, str(backend_path))

from app.database import SessionLocal
from app.storage.metadata_storage import SQLiteMetadataStorage
from app.storage.markdown_storage import FilesystemMarkdownStorage
from app.services.memory_service import MemoryService
from app.schemas.memory import MemoryCreate
from app.workers.knowledge_pipeline import start_knowledge_pipeline
from app.config import settings

def main():
    print("Iniciando a criação de memória do Hermes...")
    
    # 1. Start knowledge pipeline so it listens to MemoryCreated event and generates embeddings
    start_knowledge_pipeline()
    
    # 2. Open DB session
    db = SessionLocal()
    try:
        metadata_storage = SQLiteMetadataStorage(db)
        markdown_storage = FilesystemMarkdownStorage(settings.MEMORIES_PATH)
        service = MemoryService(metadata_storage, markdown_storage)
        
        title = "Hermes Agent: Arquitetura, Funcionamento e Integração com o Arkan Vault"
        summary = "Visão geral e documentação técnica do Hermes Agent, abordando sua arquitetura, o pipeline de voz com roteamento dinâmico (agentic, memory, quick), o ciclo de aprendizado com Honcho e a integração de memória de longo prazo com o Arkan Vault."
        
        content = """# Hermes Agent: Arquitetura, Funcionamento e Integração com o Arkan Vault

## Visão Geral

O **Hermes Agent** é um assistente pessoal de IA desenvolvido pela Nous Research, projetado para ser autoaperfeiçoável por meio de um ciclo fechado de aprendizado. Diferente de agentes convencionais executados localmente de forma estrita, o Hermes pode rodar em servidores em nuvem ou ambientes serverless persistentes (como Daytona e Modal), com interfaces acessíveis via múltiplos canais de mensageria (Telegram, Discord, Slack, WhatsApp, Signal, e CLI).

Ele se baseia nos seguintes pilares fundamentais:
1. **Ciclo Fechado de Aprendizado**: Criação de habilidades a partir de experiências práticas (procedural memory), autoaperfeiçoamento de skills e construção contínua de um modelo do usuário através de sessões (Dialectic User Modeling baseado em Honcho).
2. **Gateway Multicanais**: Uma única instância do gateway gerencia a comunicação em várias plataformas, garantindo continuidade e histórico unificado.
3. **Persistência de Memória**: Integração nativa com o **Arkan Vault** para armazenamento e busca de longo prazo (memórias persistentes).

---

## Estrutura de Diretórios e Arquivos

No ambiente nativo Windows do usuário, a instalação do Hermes está localizada em:
`C:\\Users\\itach\\AppData\\Local\\hermes\\`

Principais componentes dessa pasta:
*   `SOUL.md`: Define a personalidade base (o "prompt de sistema" inicial do agente).
*   `config.yaml`: Centraliza todas as configurações do agente, incluindo:
    *   **Provedor de Modelos**: Modelo default (ex. `gemini-3.5-flash-lite`), reasoning effort, etc.
    *   **Memory**: Provedor configurado (`provider: arkan`), nudges, limites de caracteres.
    *   **STT (Speech-to-Text)**: Configurado com Groq (`whisper-large-v3-turbo`) em português, com um prompt inicial rico contendo palavras-chave locais (Arkan Vault, Hermes, Loopin TV, São José do Piauí, etc.).
    *   **TTS (Text-to-Speech)**: Configurado com o provedor `edge` e voz em português brasileiro (`pt-BR-FranciscaNeural`).
*   `hermes-agent/`: Subdiretório que contém o código-fonte principal em Python do agente.
    *   `agent/`: Lógica central do loop do agente, gerenciamento de contexto, ferramentas e voz.
    *   `plugins/memory/arkan/`: Código de integração com o Arkan Vault.
    *   `cli.py` / `run_agent.py`: Interfaces de execução.
*   `memories/`: Memória local complementar de curta duração.
*   `skills/`: Diretório de habilidades adquiridas e scripts de execução autônomos.

---

## O Pipeline de Voz e Roteamento Low-Latency

Localizado em `hermes-agent/agent/voice_profile.py`, o Hermes utiliza um roteamento de voz determinístico baseado em expressões regulares para reduzir a latência de turnos falados:

### Modos de Roteamento de Voz
Ao receber uma requisição de áudio (transcrita por STT), a função `select_voice_route` seleciona uma das três rotas abaixo:
1.  **`agentic`**: Loop completo do agente com acesso total a ferramentas (shell, web, etc.). Ativado se o input contiver palavras como "pesquisar", "código", "terminal", "executar", ou se a mensagem exceder 420 caracteres.
2.  **`memory`**: Rota focada em consultas à base de conhecimento. Ativado por termos de memória ("preferência", "decisão", "arkan", "vault", "projeto", "lembrar", "eu disse"). Filtra as ferramentas disponíveis, permitindo apenas as ferramentas que começam com `arkan_` (como `arkan_search`, `arkan_list`, `arkan_files`).
3.  **`quick`**: Respostas conversacionais ou explicativas simples ("bom dia", "como funciona", "explique"). Não utiliza ferramentas para máxima velocidade e menor custo.

### Scrubber e Agentic Fallback
Se uma execução nas rotas mais rápidas (`memory` ou `quick`) encontrar uma barreira (ex. necessitar de pesquisa na web ou comando de terminal), o modelo responde com a tag especial `[[HERMES_AGENTIC_FALLBACK]]`.
A classe `VoiceFallbackScrubber` intercepta esse token no fluxo de streaming, aborta a resposta atual, altera a rota e reinicia o turno na rota `agentic` de forma transparente.

---

## Integração com o Arkan Vault

O Hermes utiliza o Arkan Vault como seu provedor principal de memória persistente. A integração está implementada em `plugins/memory/arkan/__init__.py` e interage com o Vault através do cliente Python `arkan_vault.ArkanVaultClient`.

### Ferramentas de Memória Expostas ao Agente
*   `arkan_search`: Busca semântica e híbrida de memórias por relevância.
*   `arkan_remember`: Cria e persiste uma nova memória (fato, tarefa, ideia, decisão) no Vault.
*   `arkan_update`: Atualiza uma memória existente (correções e evoluções).
*   `arkan_forget`: Deleta permanentemente uma memória obsoleta.
*   `arkan_list`: Lista memórias de forma estruturada (sem busca semântica), ideal para inventários e auditorias.
*   `arkan_files`: Lista e inspeciona arquivos binários indexados pelo Arkan Vault.

### Circuit Breaker e Resiliência
Para evitar falhas graves quando o servidor do Arkan Vault estiver offline (por exemplo, quando o túnel Tailscale cair), o plugin possui uma lógica de **Circuit Breaker** com um thread de sondagem em segundo plano (`_probe_loop`).
*   Se o servidor do Vault falhar em responder, o circuito passa de `closed` (operando normalmente) para `open`.
*   Nesse estado, as ferramentas do Arkan não são executadas (evitando timeouts que travam o loop do agente), e uma mensagem de erro controlada é enviada.
*   O thread sonda o status do servidor a cada cooldown configurável (padrão: 45 segundos). Quando a conexão é reestabelecida, o circuito é fechado novamente.
"""
        
        data = MemoryCreate(
            type="memory",
            title=title,
            project="hermes",
            tags=["hermes", "agent", "architecture", "voice", "learning-loop", "arkan-vault"],
            summary=summary,
            content=content,
            context={"source": "api", "created_by": "Antigravity", "location": "Local"}
        )
        
        obj = service.create(data)
        print(f"Memory successfully created!")
        print(f"ID: {obj.id}")
        print(f"Title: {obj.title}")
        print(f"Markdown Path: {obj.markdown_path}")
        
    except Exception as e:
        print(f"Error creating memory: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    main()
