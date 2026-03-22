export function handleHealth(): { statusCode: number; body: string; headers: Record<string, string> } {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
  };
}
