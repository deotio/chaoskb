export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MAX_BLOB_SIZE = 1_048_576; // 1 MB
const MIN_BLOB_SIZE = 1;

export function validateBlobUpload(body: Buffer, contentType: string): ValidationResult {
  if (contentType !== 'application/octet-stream') {
    return { valid: false, error: 'Content-Type must be application/octet-stream' };
  }

  if (body.length < MIN_BLOB_SIZE) {
    return { valid: false, error: 'Blob must be at least 1 byte' };
  }

  if (body.length > MAX_BLOB_SIZE) {
    return { valid: false, error: `Blob exceeds maximum size of ${MAX_BLOB_SIZE} bytes` };
  }

  // Parse as JSON and check envelope structure
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf-8'));
  } catch {
    return { valid: false, error: 'Blob must be valid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, error: 'Blob must be a JSON object' };
  }

  const envelope = parsed as Record<string, unknown>;
  if (!('v' in envelope)) {
    return { valid: false, error: 'Missing required field: v' };
  }

  if (envelope['v'] !== 1) {
    return { valid: false, error: `Unsupported envelope version: ${envelope['v']}` };
  }

  return { valid: true };
}
