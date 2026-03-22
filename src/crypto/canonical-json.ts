/**
 * RFC 8785 Canonical JSON serialization.
 * Sorted keys (recursive), no whitespace, proper Unicode escaping.
 */
export function canonicalJson(obj: Record<string, unknown>): string {
  return serializeValue(obj);
}

function serializeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';

    case 'number':
      return serializeNumber(value);

    case 'string':
      return serializeString(value);

    case 'object':
      if (Array.isArray(value)) {
        return serializeArray(value);
      }
      return serializeObject(value as Record<string, unknown>);

    default:
      throw new TypeError(`Unsupported type: ${typeof value}`);
  }
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new TypeError(`Non-finite number: ${n}`);
  }
  // RFC 8785: use ES2015 Number serialization (which JSON.stringify uses)
  // For integers, no decimal point. For floats, shortest representation.
  if (Object.is(n, -0)) {
    return '0';
  }
  return JSON.stringify(n);
}

function serializeString(s: string): string {
  // RFC 8785: escape control characters, backslash, double-quote.
  // Characters U+0000..U+001F must be escaped with \uXXXX (except \b \f \n \r \t which use short form).
  // All other characters (including non-BMP via surrogate pairs) are passed through literally.
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x08) {
      result += '\\b';
    } else if (code === 0x09) {
      result += '\\t';
    } else if (code === 0x0a) {
      result += '\\n';
    } else if (code === 0x0c) {
      result += '\\f';
    } else if (code === 0x0d) {
      result += '\\r';
    } else if (code === 0x22) {
      result += '\\"';
    } else if (code === 0x5c) {
      result += '\\\\';
    } else if (code < 0x20) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      result += s[i];
    }
  }
  result += '"';
  return result;
}

function serializeArray(arr: unknown[]): string {
  const items = arr.map((item) => serializeValue(item));
  return '[' + items.join(',') + ']';
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const pairs = keys
    .filter((key) => obj[key] !== undefined)
    .map((key) => serializeString(key) + ':' + serializeValue(obj[key]));
  return '{' + pairs.join(',') + '}';
}
