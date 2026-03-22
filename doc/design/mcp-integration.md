# MCP Integration

## The Problem

In the standard architecture, Claude calls MCP tools directly on the server. In the E2E architecture, the server can't process content — it only stores encrypted blobs. Claude can't call `kb_query` on a server that can't search.

## Solution: Local MCP Server (`chaoskb-mcp`)

A TypeScript CLI application that runs on the user's desktop. It:

1. Exposes `kb_ingest`, `kb_query`, `kb_list`, `kb_delete` tools via MCP (stdio)
2. Holds the decryption key in memory
3. Maintains a local SQLite database and in-memory embedding index
4. Optionally syncs encrypted blobs with a remote server

```
Any MCP-compatible chat agent
(Claude Desktop, Claude Code, Cursor, Windsurf, VS Code/Copilot, etc.)
        │
        │ MCP (stdio transport — agent spawns the process)
        ▼
chaoskb-mcp (TypeScript CLI)
        │
        ├── snowflake-arctic-embed-s (ONNX Runtime, statically linked, 384-dim)
        ├── Decrypted index (in-memory, ~73MB at 50k chunks)
        ├── SQLite (~/.chaoskb/local.db)
        ├── XChaCha20-Poly1305 encryption
        │
        │ HTTPS (encrypted blobs only) — optional
        ▼
Remote Server (Lambda + DynamoDB only) — optional
```

This is similar to how password managers work — a local agent that decrypts and an optional remote server that stores ciphertext.

### Installation

The install script (`curl -sSf https://chaoskb.com/install.sh | sh`) places the `chaoskb-mcp` binary on your PATH. Run `chaoskb-mcp register` to auto-register with detected chat agents.

```bash
# After installation, the binary is available system-wide:
chaoskb-mcp              # run as MCP server (stdio, launched by agents)
chaoskb-mcp register     # detect and register with installed agents
chaoskb-mcp status       # show config, registered agents, storage usage
chaoskb-mcp setup sync   # configure server endpoint (optional, can do anytime)
```

The ONNX embedding model (~134 MB) is downloaded on first run to `~/.chaoskb/models/`. After download, the binary verifies the model's SHA-256 hash against a hard-coded expected value. If the hash does not match (indicating a corrupted download or compromised CDN), the binary refuses to load the model and reports an error. This prevents a tampered model from producing biased embeddings that could leak information through search ranking patterns.

### Binary contents

| Component | Size (approx) | Included via |
|-----------|---------------|-------------|
| MCP server (stdio) | ~5 MB | Compiled in |
| ONNX Runtime | ~30 MB | `onnxruntime-node` npm package |
| SQLite | ~1 MB | `better-sqlite3` npm package |
| XChaCha20-Poly1305 | Negligible | `@noble/ciphers` (pure JS, audited) |
| HKDF / Argon2id | Negligible | `@noble/hashes` (pure JS, audited) |

Requires Node.js >= 18.

## MCP Tools

```
kb_ingest(url, tags?)     — fetch URL, extract, chunk, embed, encrypt, store locally (+ sync if server configured)
kb_query(query, limit?)   — embed query locally, brute-force cosine similarity search, return ranked results
kb_list(limit?, offset?)  — list saved sources with metadata (title, URL, date, chunk count)
kb_delete(id)             — soft-delete a source and its chunks (30-day trash)
kb_summary(period)        — return articles added during a time period, grouped for the agent to summarize
```

### Ingest flow (pseudocode)

```
kb_ingest(url):
  text = fetch_and_extract(url)            // fetch locally, Readability extraction
  chunks = chunk_text(text)                 // ~500 tokens, 50 token overlap
  embeddings = embed_local(chunks)          // snowflake-arctic-embed-s via ONNX
  store_local(source, chunks, embeddings)   // SQLite + in-memory index → searchable immediately
  if server_configured:
    encrypted = encrypt_blobs(source, chunks, embeddings)
    upload_blobs(encrypted)                 // async, best-effort
  return "Ingested '{title}' ({n} chunks)"
```

### Summary tool

`kb_summary` returns a structured overview of articles added during a time period. The MCP server provides the data; the chat agent does the summarization.

```
kb_summary(period):
  // period: "week", "month", "year", or "YYYY-MM-DD:YYYY-MM-DD" for custom range
  sources = query_sources_by_date_range(period)
  return {
    period: "2026-03-14 to 2026-03-21",
    total_articles: 18,
    total_chunks: 216,
    articles: [
      { title, url, date, chunk_count, tags, first_chunk_preview },
      ...
    ]
  }
```

The response includes a preview (first chunk, ~500 tokens) of each article so the agent has enough context to produce a meaningful summary without needing to query each article individually.

**Usage examples:**
- "Give me a summary of what I added this week" → agent calls `kb_summary("week")`, summarizes the results
- "What did I save last month?" → agent calls `kb_summary("month")`
- "Summarize my 2025 reading" → agent calls `kb_summary("2025-01-01:2025-12-31")`

## MCP Transport

**stdio** — the chat agent spawns `chaoskb-mcp` as a child process. No network involved for MCP communication. This is the simplest and most secure transport.

### Agent registration

The installer auto-detects installed agents and registers `chaoskb-mcp` with each one. The registration writes a config entry to each agent's MCP config file.

Supported agents (via updatable agent registry at `chaoskb.com/api/agent-registry.json`):

| Agent | Config file (macOS) |
|-------|---------------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot) | `.vscode/mcp.json` or VS Code settings |
| Continue.dev | `~/.continue/config.json` |

The registry is updatable without a binary release — new agents or config path changes are handled by updating the hosted registry at `chaoskb.com/api/agent-registry.json`.

### Manual registration

```bash
chaoskb-mcp register                    # auto-detect all agents
chaoskb-mcp register --agent cursor     # specific agent
```

Or manually add to any agent's MCP config:

```json
{
  "mcpServers": {
    "chaoskb": {
      "command": "chaoskb-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

The `env` block can optionally include `CHAOSKB_ENDPOINT` for server sync. If omitted, `chaoskb-mcp` reads from `~/.chaoskb/config.json` or runs in local-only mode.

**Authentication:** Requests are signed using the user's SSH private key. The `chaoskb-mcp` binary reads the SSH private key from ssh-agent (`SSH_AUTH_SOCK`) or falls back to `~/.ssh/id_ed25519`. No ChaosKB-specific credential storage is needed — the user's existing SSH key infrastructure is reused. The `chaoskb-mcp setup sync` command stores only the endpoint in `~/.chaoskb/config.json` (permissions `0600`).

For CI/container environments without ssh-agent, set `CHAOSKB_SSH_KEY_PATH` to point to the private key file.

### Lifecycle

The `chaoskb-mcp` process is **not** a daemon. It's spawned by the chat agent on startup and exits when the agent quits. No login items, no background services. If no agent is running, ChaosKB uses zero desktop resources.

## Startup Flow

```
1. Chat agent spawns chaoskb-mcp (stdio)
2. chaoskb-mcp reads config from ~/.chaoskb/config.json
3. Signs requests using SSH key from ssh-agent (SSH_AUTH_SOCK) or ~/.ssh/id_ed25519
4. Opens local SQLite database (~/.chaoskb/local.db)
5. Loads embeddings into memory from local store
6. If first run: downloads ONNX model (~134 MB) to ~/.chaoskb/models/
7. Verifies ONNX model SHA-256 hash against hard-coded expected value
   → If mismatch: refuse to load, report error, exit
8. If server configured: incremental sync (download new blobs, decrypt, merge)
9. Reports MCP tools as available
10. Agent can now call kb_ingest, kb_query, kb_list, kb_delete
```

Startup time: ~1-3 seconds (load index + sync). First run is slower due to model download.

## Flutter App Integration

The Flutter app doesn't go through MCP. It performs the same operations directly:

```
Share Sheet → Flutter App
                 │
                 ├── Fetch URL (client-direct)
                 ├── Chunk + embed (on-device)
                 ├── Encrypt
                 ├── Upload blobs to server
                 └── Update local index
```

Both `chaoskb-mcp` and the Flutter app are clients of the same local database (and optionally the same encrypted blob store), sharing the same key and sync protocol.

## Limitations

- **Agent doesn't see content during ingest.** The agent only sees the tool response (title, chunk count). The full article content is on the user's machine, not in the agent's context. The agent can query it back with `kb_query` if needed.
- **No server-side triggers.** Can't do things like "auto-tag new articles" on the server, since the server can't read the content. Must happen on the client.
- **`chaoskb-mcp` must be running.** If the process isn't running (agent closed, machine off), the KB is inaccessible to the agent. The local SQLite database and mobile app still work independently.
