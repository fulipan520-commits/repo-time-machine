import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildServer,
  InMemoryBundleStore,
  InMemoryJobStore,
  validateGithubRepository,
} from "./server";

const servers: Array<Awaited<ReturnType<typeof buildServer>>> = [];

function createServer(
  options: Partial<Parameters<typeof buildServer>[0]> = {},
): ReturnType<typeof buildServer> {
  const server = buildServer({
    jobStore: new InMemoryJobStore(),
    bundleStore: new InMemoryBundleStore(),
    now: () => new Date("2026-11-12T00:00:00.000Z"),
    ...options,
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("validateGithubRepository", () => {
  it("accepts canonical GitHub repository URLs", () => {
    expect(
      validateGithubRepository("https://github.com/acme/widget.git"),
    ).toEqual({
      ok: true,
      value: {
        owner: "acme",
        name: "widget",
        canonicalUrl: "https://github.com/acme/widget",
      },
    });
  });

  it("rejects non-GitHub and nested URLs", () => {
    expect(
      validateGithubRepository("https://example.com/acme/widget").ok,
    ).toBe(false);
    expect(
      validateGithubRepository("https://github.com/acme/widget/tree/main").ok,
    ).toBe(false);
  });
});

describe("analysis API", () => {
  it("creates and reads a queued analysis job", async () => {
    const server = createServer();
    const create = await server.inject({
      method: "POST",
      url: "/api/analyses",
      payload: {
        repositoryUrl: "https://github.com/acme/widget",
        branch: "main",
      },
    });

    expect(create.statusCode).toBe(202);
    expect(create.json().status).toBe("queued");

    const status = await server.inject({
      method: "GET",
      url: `/api/analyses/${create.json().id}`,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().repository.name).toBe("widget");
  });

  it("cancels only non-terminal jobs", async () => {
    const server = createServer();
    const create = await server.inject({
      method: "POST",
      url: "/api/analyses",
      payload: { repositoryUrl: "https://github.com/acme/widget" },
    });
    const jobId = create.json().id as string;

    const cancelled = await server.inject({
      method: "POST",
      url: `/api/analyses/${jobId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(202);
    expect(cancelled.json().status).toBe("cancelled");

    const repeated = await server.inject({
      method: "POST",
      url: `/api/analyses/${jobId}/cancel`,
    });
    expect(repeated.statusCode).toBe(409);
  });

  it("rejects invalid repository URLs and returns 404 for unknown jobs", async () => {
    const server = createServer();
    const invalid = await server.inject({
      method: "POST",
      url: "/api/analyses",
      payload: { repositoryUrl: "https://example.com/acme/widget" },
    });
    const missing = await server.inject({
      method: "GET",
      url: "/api/analyses/missing",
    });

    expect(invalid.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
  });

  it("rate limits analysis creation by client address", async () => {
    const server = createServer({
      admission: {
        maxRequestsPerWindow: 1,
        windowMs: 60_000,
        maxOutstandingJobs: 10,
      },
    });

    const first = await server.inject({
      method: "POST",
      url: "/api/analyses",
      remoteAddress: "203.0.113.10",
      payload: { repositoryUrl: "https://github.com/acme/widget" },
    });
    const second = await server.inject({
      method: "POST",
      url: "/api/analyses",
      remoteAddress: "203.0.113.10",
      payload: { repositoryUrl: "https://github.com/acme/widget" },
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("60");
    expect(second.json().error.code).toBe("RATE_LIMITED");
  });

  it("rejects new jobs when the outstanding-job cap is reached", async () => {
    const server = createServer({
      admission: {
        maxRequestsPerWindow: 10,
        windowMs: 60_000,
        maxOutstandingJobs: 1,
      },
    });

    const first = await server.inject({
      method: "POST",
      url: "/api/analyses",
      remoteAddress: "203.0.113.10",
      payload: { repositoryUrl: "https://github.com/acme/widget" },
    });
    const second = await server.inject({
      method: "POST",
      url: "/api/analyses",
      remoteAddress: "203.0.113.11",
      payload: { repositoryUrl: "https://github.com/acme/other" },
    });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("CAPACITY_REACHED");
  });

  it("notifies the runner when an analysis is cancelled", async () => {
    const onJobCancelled = vi.fn();
    const server = createServer({ onJobCancelled });
    const create = await server.inject({
      method: "POST",
      url: "/api/analyses",
      payload: { repositoryUrl: "https://github.com/acme/widget" },
    });
    const jobId = create.json().id as string;

    await server.inject({
      method: "POST",
      url: `/api/analyses/${jobId}/cancel`,
    });

    expect(onJobCancelled).toHaveBeenCalledWith(jobId);
  });
});
