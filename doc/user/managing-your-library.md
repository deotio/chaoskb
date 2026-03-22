# Managing Your Library

## Search

Ask your chat agent to search in natural language:

> "Search my knowledge base for articles about database performance"

Search is local and fast (<50ms). It works offline — no server connection needed. Results are ranked by relevance to your query.

### Search tips

- Use specific terms for precise results: "Rust borrow checker" rather than "programming"
- Search finds content within articles, not just titles
- You can limit results: "Find the top 3 articles about encryption"

## Listing articles

> "List my saved articles"
> "Show me the last 20 articles I saved"

This returns titles, URLs, save dates, and chunk counts.

## Deleting articles

> "Delete the article about Rust ownership"

Deleted articles go to **trash** for 30 days. During that time:
- You see a 5-second **Undo** option immediately after deletion
- Trash is visible in the app under "Recently Deleted"
- You can restore any item from trash
- Other devices see the deletion on their next sync

After 30 days, trashed items are permanently removed.

To permanently delete immediately (skip the 30-day window), use the manual purge option in trash settings.

## Storage

### How storage works

Every article you save is split into chunks (~500 tokens each). Each chunk is encrypted and stored as a blob (~4.5 KB). A typical article produces about 12 chunks.

| Library size | Approximate storage |
|-------------|-------------------|
| 100 articles | ~6 MB |
| 1,000 articles | ~58 MB |
| 5,000 articles | ~290 MB |

Local storage (on your device) is unlimited. Synced storage (on the server) depends on your plan.

### Storage dashboard

In Settings, the storage dashboard shows:

- **Total synced storage used** with a visual bar (e.g., "38 MB of 50 MB")
- **Top sources by size** — your largest articles
- **Storage by age** — breakdown by time period

### When you're running low

| Threshold | What happens |
|-----------|-------------|
| 80% used | Storage bar turns amber |
| 95% used | Banner suggesting cleanup or upgrade |
| 100% used | New articles save locally but don't sync. No data loss, no blocked features. |

At 100%, everything still works — you just won't get new backups until you free space.

## Bulk cleanup

In **Settings > Manage Library**, you can filter and sort your articles to find what to delete:

| Filter | Finds |
|--------|-------|
| Oldest first | Stale content from months or years ago |
| Largest first | Articles consuming the most space |
| Never accessed | Articles you saved but never searched for |
| Not accessed since... | Articles that haven't been useful recently |

Select multiple articles and delete in bulk. Everything goes to trash with the same 30-day recovery window.
