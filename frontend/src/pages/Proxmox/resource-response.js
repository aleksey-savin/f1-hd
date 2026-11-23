/** Read a section snapshot without advancing its baseline past request start. */
export async function readResourceResponse(response, assertCurrent) {
  const data = response.ok
    ? await response.json()
    : await response.json().catch(() => null);
  assertCurrent();
  if (!response.ok) {
    const error = new Error(
      data?.message || `Запрос не удался (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return { ...data, pulse: response.headers.get("X-Pulse-Cursor") };
}
