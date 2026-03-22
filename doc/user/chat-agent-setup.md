# Chat Agent Setup

ChaosKB runs as an MCP server that any compatible chat agent can use. The installer auto-registers with detected agents, but you can also set it up manually.

## Auto-registration

```bash
chaoskb-mcp register                    # detect and register with all installed agents
chaoskb-mcp register --agent cursor     # register with a specific agent
```

## Supported agents

| Agent | Config file (macOS) |
|-------|---------------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude/settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| VS Code (Copilot) | `.vscode/mcp.json` or VS Code settings |
| Continue.dev | `~/.continue/config.json` |

Config paths vary by platform. Run `chaoskb-mcp register` to have the paths detected automatically.

## Manual registration

If auto-registration doesn't work for your agent, add this to your agent's MCP config:

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

If you've configured server sync, you can optionally include the endpoint in the env block:

```json
{
  "mcpServers": {
    "chaoskb": {
      "command": "chaoskb-mcp",
      "args": [],
      "env": {
        "CHAOSKB_ENDPOINT": "https://your-endpoint.lambda-url.us-east-1.on.aws"
      }
    }
  }
}
```

Authentication uses your SSH key via ssh-agent (Ed25519 primary, RSA fallback). No API key or credentials are stored in config files.

## How it works

ChaosKB is not a background service. Your chat agent spawns `chaoskb-mcp` as a child process when it starts and the process exits when the agent quits. No login items, no daemons, no background resource usage.

When the agent starts ChaosKB:
1. Loads your local database and embedding index
2. Syncs with the server (if configured)
3. Reports its tools as available
4. Waits for tool calls from the agent

Startup takes 1-3 seconds.

## Verifying registration

After registration, restart your chat agent and ask:

> "What tools do you have from ChaosKB?"

The agent should list `kb_ingest`, `kb_query`, `kb_list`, `kb_delete`, and `kb_summary`.

## Multiple agents

ChaosKB can be registered with multiple agents simultaneously. They all share the same local database and encryption keys. Only one agent can run `chaoskb-mcp` at a time — if you switch agents, close the first one before opening the second.
