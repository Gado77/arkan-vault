# Hermes Agent + Arkan Vault

This integration implements Hermes' native `MemoryProvider` interface. It adds:

- automatic semantic recall before each turn;
- `arkan_search`, `arkan_list`, `arkan_files`, `arkan_remember`, `arkan_update`, and `arkan_forget` tools;
- exact, non-semantic inventory for counts and exhaustive file listings;
- optional full-turn archival (`sync_turns`, disabled by default);
- the built-in small `MEMORY.md` / `USER.md` stores remain active.

## Install

From the Arkan Vault directory on Windows:

```powershell
.\integrations\hermes\install.ps1 -HermesPath C:\path\to\hermes-agent
```

Then, inside the Hermes environment:

```text
hermes memory setup
```

Select `arkan`. The installer writes `ARKAN_VAULT_URL` and
`ARKAN_VAULT_SDK_PATH` to the Hermes checkout's `.env`. The machine running
Hermes must be connected to the same Tailscale network as the Vault.

To scope recall and writes to one project:

```powershell
.\integrations\hermes\install.ps1 -HermesPath C:\path\to\hermes-agent -Project arkan-vault
```

In `$HERMES_HOME/arkan.json`, `sync_turns` defaults to `false`: durable facts
are stored explicitly by the model, while relevant existing memories are still
prefetched automatically. Set it to `true` only if you want every full turn
archived as a `conversation` memory.

## Linux

Install Hermes first, keep this Arkan Vault checkout available on the same
machine, then run:

```bash
bash integrations/hermes/install.sh
hermes memory status
hermes doctor
```

The default Hermes checkout is `$HERMES_HOME/hermes-agent` or
`~/.hermes/hermes-agent`. Pass a different checkout as the first argument when
needed.
