# Arkan Vault — Servidor pessoal

Estado operacional registrado em 2026-08-05.

## Endereços

- Acesso privado permanente: <https://arkan-server.tail9b08be.ts.net/>
- Endereço LAN observado: `http://192.168.1.19:8765/`
- Saúde: `https://arkan-server.tail9b08be.ts.net/health`
- API: `https://arkan-server.tail9b08be.ts.net/docs`

O endereço Tailscale é o endereço canônico. Ele continua válido quando o DHCP
altera o IP local e usa conexão direta quando cliente e servidor estão na mesma
rede. O endereço LAN é apenas uma conveniência e pode mudar.

## Servidor

- Hostname: `arkan-server`
- Usuário de serviço: `vitor`
- Sistema: Ubuntu 26.04 LTS, x86_64
- Projeto: `/opt/arkan-vault`
- Dados persistentes: `/opt/arkan-vault/backend/data`
- Python: `/opt/arkan-vault/backend/.venv` (3.11)
- Serviço: `arkan-vault.service`
- Porta local: `8765`

O serviço inicia automaticamente e usa `Restart=always`.

## Dados que devem ser migrados

```text
backend/data/arkan.db          metadados e relações
backend/data/memories/         conteúdo Markdown
backend/data/chroma/           embeddings e índice vetorial
backend/data/files/            arquivos originais e uploads
```

O código pode ser reinstalado; `backend/data` é a memória insubstituível.

## Backups

- Local: `/var/backups/arkan-vault`
- Timer: `arkan-vault-backup.timer`
- Frequência: diária, aproximadamente 03:15
- Retenção: 14 dias
- Verificação: SHA-256, SQLite, ChromaDB e contagem de arquivos

```bash
systemctl status arkan-vault.service
systemctl list-timers arkan-vault-backup.timer
sudo ls -lh /var/backups/arkan-vault
```

O backup no mesmo HD não protege contra defeito físico. Uma segunda cópia em
outro dispositivo continua sendo necessária.

## Acesso remoto

O servidor usa Tailscale Serve com HTTPS privado. Não abrir ou encaminhar a
porta `8765` na internet. Novos aparelhos devem entrar na mesma rede Tailscale.

```bash
tailscale status
tailscale serve status
```

Nunca registrar senhas, chaves SSH ou tokens neste documento.

## Regra de documentação

Toda mudança relevante de arquitetura, implantação, endereço, armazenamento,
backup ou integração deve atualizar a pasta do projeto e, quando útil para
agentes, a memória canônica armazenada no próprio Arkan Vault.
