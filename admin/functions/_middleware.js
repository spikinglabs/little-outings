import { verifyAccess } from "../lib/access.js";

// Every page, asset and API call needs a valid Cloudflare Access sign-in.
export async function onRequest(context) {
  try {
    context.data.user = await verifyAccess(context.request, context.env);
  } catch (error) {
    return new Response(`Not allowed: ${error.message}`, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
