// Talks to the Worker. Every write carries the X-Care-Chart header the server requires.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `Request failed (${status}).`);
    this.status = status;
    this.body = body ?? {};
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { "X-Care-Chart": "1" } : { "Content-Type": "application/json", "X-Care-Chart": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: "Cannot reach the server. Check the internet connection." });
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/api/login")) {
    window.dispatchEvent(new CustomEvent("care-chart:signed-out"));
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}
