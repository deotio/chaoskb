import type { McpDependencies } from '../mcp-server.js';

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

  // 4. Enqueue blob deletions for sync (queue processor handles server delete)
  const chunks = db.chunks.getBySourceId(input.id);
  const allBlobIds = [input.id, ...chunks.map((c) => c.id)];

  for (const blobId of allBlobIds) {
    db.enqueueDelete(blobId);
  }

  return { id: input.id, deleted: true };
}
