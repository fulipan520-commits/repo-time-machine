import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("proxies API requests to the configured upstream", async () => {
  vi.stubEnv("API_ORIGIN", "https://api.example.com/");
  const upstreamFetch = vi.fn(async () =>
    Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } }),
  );
  vi.stubGlobal("fetch", upstreamFetch);

  const response = await GET(
    new Request("https://web.example.com/api/service/analyses/job-1?full=1"),
    { params: Promise.resolve({ path: ["analyses", "job-1"] }) },
  );

  expect(upstreamFetch).toHaveBeenCalledOnce();
  const [url, init] = upstreamFetch.mock.calls[0] as unknown as [
    URL,
    RequestInit,
  ];
  expect(url.toString()).toBe(
    "https://api.example.com/api/analyses/job-1?full=1",
  );
  expect(init.method).toBe("GET");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});

it("forwards POST request bodies", async () => {
  vi.stubEnv("API_HOST", "api.onrender.com");
  const upstreamFetch = vi.fn(async () => Response.json({ id: "job-1" }));
  vi.stubGlobal("fetch", upstreamFetch);

  await POST(
    new Request("https://web.example.com/api/service/analyses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repositoryUrl: "https://github.com/acme/widget" }),
    }),
    { params: Promise.resolve({ path: ["analyses"] }) },
  );

  const [url, init] = upstreamFetch.mock.calls[0] as unknown as [
    URL,
    RequestInit,
  ];
  expect(url.toString()).toBe("https://api.onrender.com/api/analyses");
  expect(init.body).toContain("https://github.com/acme/widget");
});
