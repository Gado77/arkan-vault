# Arkan Vault operations

Operational files for the Linux server.

## Backups

`backup.sh` briefly stops `arkan-vault.service`, archives `backend/data`, writes a
SHA-256 checksum, starts the service again, and removes local generations older
than 14 days. Logs are excluded. The timer runs daily at 03:15 with up to ten
minutes of randomized delay.

`verify-backup.sh` extracts a backup into a temporary directory and validates the
checksum, the main SQLite database, the ChromaDB SQLite database, and stored file
counts. It never replaces live data.

Local archives live in `/var/backups/arkan-vault`. They protect against accidental
changes and database corruption, but a second copy on another physical device is
still required to protect against disk failure.
