interface RouteContext {
  params: Promise<{ path: string[] }>;
}

function apiOrigin(): string {
  const explicitOrigin = process.env.API_ORIGIN?.replace(/\/$/, "");
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const renderHost = process.env.API_HOST?.replace(/^https?:\/\//, "");
  if (renderHost) {
    return `https://${renderHost}`;
  }

  return "http://127.0.0.1:3001";
}

async function proxy(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(
    `/api/${path.map(encodeURIComponent).join("/")}`,
    apiOrigin(),
  );
  targetUrl.search = sourceUrl.search;

  try {
    const headers = new Headers();
    const contentType = request.headers.get("content-type");
    const accept = request.headers.get("accept");
    if (contentType) {
      headers.set("content-type", contentType);
    }
    if (accept) {
      headers.set("accept", accept);
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : null,
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    const cacheControl = upstream.headers.get("cache-control");
    if (upstreamContentType) {
      responseHeaders.set("content-type", upstreamContentType);
    }
    if (cacheControl) {
      responseHeaders.set("cache-control", cacheControl);
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "The analysis service is temporarily unavailable.",
        },
      },
      { status: 502 },
    );
  }
}

export { proxy as GET, proxy as POST };
