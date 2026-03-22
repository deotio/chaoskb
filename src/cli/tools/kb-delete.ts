import type { McpDependencies } from '../mcp-server.js';
import { SyncStatus } from '../../storage/types.js';

export interface KbDeleteInput {
  id: string;
}

export interface KbDeleteResult {
  id: string;
  deleted: true;
}

export async function handleKbDelete(
  input: KbDeleteInput,
  deps: McpDependencies,
): Promise<KbDeleteResult> {
  const { db } = deps;

  // 1. Verify the source exists
  const source = db.sources.getById(input.id);
  if (!source) {
    throw new Error(`Source not found: ${input.id}`);
  }

  if (source.deletedAt) {
    throw new Error(`Source already deleted: ${input.id}`);
  }

  // 2. Soft-delete the source and its chunks
  const deleted = db.sources.softDelete(input.id);
  if (!deleted) {
    throw new Error(`Failed to delete source: ${input.id}`);
  }

  // 3. Remove from embedding index
  db.embeddingIndex.remove(input.id);

  // 4. Set sync status to pending_delete for the source and all chunks
  db.syncStatus.set(input.id, SyncStatus.PendingDelete);

  // Also mark chunk blobs for deletion
  const chunks = db.chunks.getBySourceId(input.id);
  for (const chunk of chunks) {
    db.syncStatus.set(chunk.id, SyncStatus.PendingDelete);
  }

  return { id: input.id, deleted: true };
}
