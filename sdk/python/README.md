# Arkan Vault Python client

Dependency-free client intended for Hermes and other local agents.

```python
from arkan_vault import ArkanVaultClient

vault = ArkanVaultClient()  # reads ARKAN_VAULT_URL when present

memory = vault.remember(
    "Comprar um SSD para o servidor",
    {"source": "voice", "device": "bedroom-microphone", "language": "pt-BR"},
    memory_type="task",
    project="arkan-vault",
    tags=["server", "hardware"],
)

results = vault.search("o que falta comprar para o servidor?")
details = vault.get_memory(memory["id"])
recent = vault.list_memories(project="arkan-vault", limit=20)
```

Default URL: `https://arkan-server.tail9b08be.ts.net`. Override it with
`ARKAN_VAULT_URL` for tests or another deployment. The machine running the
client must be authenticated in the same Tailscale network.
