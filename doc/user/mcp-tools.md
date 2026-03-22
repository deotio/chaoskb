# MCP Tools Reference

ChaosKB provides five tools to your chat agent. You don't call these directly — you ask your agent in natural language and it calls the right tool.

## kb_ingest — Save an article

Fetches a URL, extracts the content, chunks it, computes embeddings, and stores everything locally.

**Example prompts:**
- "Save this article: https://example.com/rust-ownership"
- "Add https://example.com/article to my knowledge base and tag it as 'rust'"
- "Ingest this URL: https://example.com/article"

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | The URL to save |
| `tags` | No | Tags to assign (e.g., `["rust", "programming"]`) |

**What happens:**
1. The article is fetched and extracted on your device
2. Text is split into chunks (~500 tokens each)
3. Each chunk is embedded using the on-device model
4. Everything is encrypted and stored locally (searchable immediately)
5. If server sync is configured, encrypted blobs upload in the background

**Response:** `Ingested "Article Title" (12 chunks)`

## kb_query — Search your knowledge base

Searches your saved articles using natural language. Embeds your query locally and finds the most similar chunks.

**Example prompts:**
- "Search my knowledge base for articles about Rust ownership"
- "What have I saved about database indexing?"
- "Find articles related to XChaCha20 encryption"

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Natural language search query |
| `limit` | No | Maximum results to return (default varies by agent) |

**Response:** Ranked list of matching chunks with their source article title, URL, and relevance score.

## kb_list — List saved articles

Lists all saved articles with metadata.

**Example prompts:**
- "List my saved articles"
- "Show me the last 10 articles I saved"
- "What's in my knowledge base?"

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `limit` | No | Maximum articles to return |
| `offset` | No | Skip this many articles (for pagination) |

**Response:** List of articles with title, URL, save date, and chunk count.

## kb_delete — Delete an article

Soft-deletes an article and its chunks. Deleted items go to trash for 30 days before permanent removal.

**Example prompts:**
- "Delete the article about Rust ownership from my knowledge base"
- "Remove this article from my KB: [article ID]"

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | The article ID to delete |

The agent will typically look up the article first (via `kb_list` or `kb_query`) to find the correct ID.

**Response:** Confirmation of deletion. Items can be restored from trash within 30 days.

## kb_summary — Summarize recent saves

Returns articles saved during a time period for the agent to summarize.

**Example prompts:**
- "Summarize what I saved this week"
- "What did I add to my knowledge base last month?"
- "Give me an overview of my 2025 reading"

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `period` | Yes | `"week"`, `"month"`, `"year"`, or a custom range like `"2025-01-01:2025-12-31"` |

**Response:** Structured list of articles with titles, URLs, dates, and a preview of each article's content. The agent uses this to generate a summary.
