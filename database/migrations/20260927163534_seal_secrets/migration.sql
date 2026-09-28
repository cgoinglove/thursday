-- Nothing in the schema changes. From this migration on, the secrets in `config` and
-- `mcp_server` are sealed (lib/secret.ts), and boot seals what an older build wrote in the
-- clear. It is recorded so that an older build refuses this database as one a newer Thursday
-- opened (database/migrate.ts NewerDatabase), rather than sending a sealed value to a provider
-- as its key. libsql refuses a migration without a statement, hence the one below.
SELECT 1;
