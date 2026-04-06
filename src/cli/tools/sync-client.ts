import { createSyncHttpClient } from '../../sync/client-factory.js';
import type { ISyncHttpClient } from '../../sync/types.js';

export interface SyncClient {
  endpoint: string;
  client: ISyncHttpClient;
  signedFetch: (method: string, urlPath: string, body?: Uint8Array) => Promise<Response>;
}

/**
 * Create an authenticated HTTP client for the sync server.
 * Shared by all device management MCP tools and CLI commands.
 */
export async function createSyncClient(): Promise<SyncClient> {
  const { client, config } = await createSyncHttpClient();

  const signedFetch = async (method: string, urlPath: string, body?: Uint8Array): Promise<Response> => {
    switch (method) {
      case 'GET': return client.get(urlPath);
      case 'PUT': return client.put(urlPath, body!);
      case 'DELETE': return client.delete(urlPath);
      case 'POST': return client.post(urlPath, body);
      default: throw new Error(`Unsupported method: ${method}`);
    }
  };

  return { endpoint: config.endpoint, client, signedFetch };
}
