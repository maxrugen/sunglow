/** Message from an error response body ({ error }), falling back to the raw text. */
export async function errorMessageFrom(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.error === 'string' && parsed.error) return parsed.error;
  } catch {
    // not JSON
  }
  return text || fallback;
}
