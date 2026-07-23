import assert from "node:assert/strict";
import test from "node:test";
import { createHandler, testing } from "../src/index.js";

const sourceSpaceflight = {
  results: [
    {
      title: "Mission reaches orbit",
      summary: "The spacecraft reached its planned orbit after launch.",
      news_site: "Orbital Wire",
      url: "https://example.com/orbit",
      published_at: "2026-07-23T12:00:00Z",
    },
  ],
};

const sourceHackerNews = {
  hits: [
    {
      title: "New database release",
      author: "operator",
      points: 42,
      num_comments: 12,
      url: "https://example.org/database",
      created_at: "2026-07-23T11:00:00Z",
    },
  ],
};

function geminiPayload() {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify([
                {
                  index: 0,
                  headline: "MISSION REACHES PLANNED ORBIT",
                  lines: [
                    "SPACECRAFT LAUNCHED",
                    "PLANNED ORBIT REACHED",
                    "MISSION REMAINS ACTIVE",
                    "SOURCE LINK AVAILABLE",
                  ],
                },
                {
                  index: 1,
                  headline: "NEW DATABASE RELEASE",
                  lines: [
                    "DATABASE RELEASE POSTED",
                    "SUBMITTED BY OPERATOR",
                    "42 PUBLIC POINTS",
                    "12 COMMENTS RECORDED",
                  ],
                },
              ]),
            },
          ],
        },
      },
    ],
  };
}

function mockFetch({ geminiOk = true } = {}) {
  return async (url, init = {}) => {
    const address = String(url);
    if (address.includes("spaceflightnewsapi.net")) {
      return Response.json(sourceSpaceflight);
    }
    if (address.includes("hn.algolia.com")) {
      return Response.json(sourceHackerNews);
    }
    if (address.includes("generativelanguage.googleapis.com")) {
      assert.equal(init.headers["x-goog-api-key"], "test-key");
      const body = JSON.parse(init.body);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
      return geminiOk
        ? Response.json(geminiPayload())
        : new Response("quota exceeded", { status: 429 });
    }
    throw new Error(`unexpected URL ${address}`);
  };
}

class MemoryCache {
  constructor() {
    this.values = new Map();
  }

  async match(key) {
    return this.values.get(key.url)?.clone();
  }

  async put(key, value) {
    this.values.set(key.url, value.clone());
  }
}

const env = {
  GEMINI_API_KEY: "test-key",
  GEMINI_MODEL: "gemini-3.6-flash",
  CACHE_SECONDS: "300",
  ALLOWED_ORIGINS: "https://thealgebraist.github.io,http://localhost:9999",
};

test("validates the exact four-line Gemini contract", () => {
  const parsed = testing.validateCondensations(
    JSON.parse(geminiPayload().candidates[0].content.parts[0].text),
    2,
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].lines.length, 4);
  assert.throws(
    () =>
      testing.validateCondensations(
        [{ index: 0, headline: "BAD", lines: ["ONLY ONE"] }],
        1,
      ),
    /four-line contract/,
  );
});

test("returns AI-condensed bulletins and retains source links", async () => {
  const handler = createHandler({
    fetchImpl: mockFetch(),
    cache: new MemoryCache(),
  });
  const response = await handler(
    new Request("https://worker.example/bulletins", {
      headers: { origin: "https://thealgebraist.github.io" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGINS.split(",")[0]);
  const body = await response.json();
  assert.equal(body.mode, "gemini");
  assert.equal(body.bulletins.length, 2);
  assert.equal(body.bulletins[0].url, "https://example.com/orbit");
  assert.equal(body.bulletins[0].lines.length, 4);
  assert.match(body.bulletins[0].source, /AI CONDENSED/);
});

test("uses source-only output when Gemini quota is unavailable", async () => {
  const handler = createHandler({
    fetchImpl: mockFetch({ geminiOk: false }),
    cache: new MemoryCache(),
  });
  const response = await handler(
    new Request("https://worker.example/bulletins"),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "source-only");
  assert.equal(body.bulletins[0].aiCondensed, false);
  assert.equal(body.bulletins[0].url, "https://example.com/orbit");
});

test("stores and reuses the general digest through the Cache API", async () => {
  const cache = new MemoryCache();
  const handler = createHandler({ fetchImpl: mockFetch(), cache });
  const requestBody = {
    records: [
      {
        title: "Global report",
        summary: "A public report.",
        source: "Wire",
        url: "https://example.com/report",
        publishedAt: "2026-07-23T12:00:00Z",
        topic: "WORLD",
        edition: "GLOBAL",
      },
    ],
    digest: {
      text: "WORLD REPORT STORED",
      maxCharacters: 600,
    },
  };
  const stored = await handler(
    new Request("https://worker.example/general-cache?slot=test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:9999",
      },
      body: JSON.stringify(requestBody),
    }),
    env,
  );
  assert.equal(stored.status, 200);
  assert.equal(stored.headers.get("x-muthur-cache"), "STORED");

  const reused = await handler(
    new Request("https://worker.example/general-cache?slot=test", {
      headers: { origin: "http://localhost:9999" },
    }),
    env,
  );
  assert.equal(reused.status, 200);
  assert.equal(reused.headers.get("x-muthur-cache"), "HIT");
  const body = await reused.json();
  assert.equal(body.digest.text, "WORLD REPORT STORED");
  assert.equal(body.records.length, 1);
});

test("executes search_news and preserves Gemini 3 tool-call metadata", async () => {
  const geminiBodies = [];
  const modelToolContent = {
    role: "model",
    parts: [
      {
        functionCall: {
          id: "call-47",
          name: "search_news",
          args: { query: "orbit" },
        },
        thoughtSignature: "signed-model-state",
      },
    ],
  };
  const fetchImpl = async (url, init = {}) => {
    const address = String(url);
    if (address.includes("spaceflightnewsapi.net")) {
      return Response.json(sourceSpaceflight);
    }
    if (address.includes("hn.algolia.com")) {
      return Response.json(sourceHackerNews);
    }
    if (address.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse(init.body);
      geminiBodies.push(body);
      if (geminiBodies.length === 1) {
        return Response.json({ candidates: [{ content: modelToolContent }] });
      }
      return Response.json({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: "The current buffer reports that the mission reached its planned orbit.",
                },
              ],
            },
          },
        ],
      });
    }
    throw new Error(`unexpected URL ${address}`);
  };

  const handler = createHandler({ fetchImpl, cache: null });
  const response = await handler(
    new Request("https://worker.example/ask", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:9999",
      },
      body: JSON.stringify({ question: "What is the latest news about orbit?" }),
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.usedTool, true);
  assert.equal(body.tool.name, "search_news");
  assert.equal(body.sources.length, 1);
  assert.equal(body.sources[0].url, "https://example.com/orbit");
  assert.equal(geminiBodies.length, 2);
  assert.deepEqual(geminiBodies[1].contents[1], modelToolContent);
  const toolResponse =
    geminiBodies[1].contents[2].parts[0].functionResponse;
  assert.equal(toolResponse.id, "call-47");
  assert.equal(toolResponse.name, "search_news");
  assert.equal(toolResponse.response.records[0].title, "Mission reaches orbit");
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "GET, POST, OPTIONS",
  );
});

test("answers general questions without calling the news tool", async () => {
  let geminiCalls = 0;
  const fetchImpl = async (url) => {
    const address = String(url);
    if (address.includes("spaceflightnewsapi.net")) {
      return Response.json(sourceSpaceflight);
    }
    if (address.includes("hn.algolia.com")) {
      return Response.json(sourceHackerNews);
    }
    if (address.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return Response.json({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "UTC is Coordinated Universal Time." }],
            },
          },
        ],
      });
    }
    throw new Error(`unexpected URL ${address}`);
  };

  const handler = createHandler({ fetchImpl, cache: null });
  const response = await handler(
    new Request("https://worker.example/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What does UTC mean?" }),
    }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(geminiCalls, 1);
  assert.equal(body.usedTool, false);
  assert.deepEqual(body.sources, []);
  assert.match(body.answer, /Coordinated Universal Time/);
});

test("validates terminal query requests", async () => {
  const handler = createHandler({ fetchImpl: mockFetch(), cache: null });
  const missing = await handler(
    new Request("https://worker.example/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "   " }),
    }),
    env,
  );
  assert.equal(missing.status, 400);

  const wrongMethod = await handler(
    new Request("https://worker.example/ask"),
    env,
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST, OPTIONS");
});

test("serves cached output without repeating upstream requests", async () => {
  let calls = 0;
  const fetchImpl = async (...args) => {
    calls += 1;
    return mockFetch()(...args);
  };
  const handler = createHandler({
    fetchImpl,
    cache: new MemoryCache(),
  });
  const request = new Request("https://worker.example/bulletins");
  const first = await handler(request, env);
  const second = await handler(request, env);
  assert.equal(first.headers.get("x-muthur-cache"), "MISS");
  assert.equal(second.headers.get("x-muthur-cache"), "HIT");
  assert.equal(calls, 3);
});

test("does not replay an allowed CORS origin from cache", async () => {
  const handler = createHandler({
    fetchImpl: mockFetch(),
    cache: new MemoryCache(),
  });
  await handler(
    new Request("https://worker.example/bulletins", {
      headers: { origin: "https://thealgebraist.github.io" },
    }),
    env,
  );
  const disallowed = await handler(
    new Request("https://worker.example/bulletins", {
      headers: { origin: "https://attacker.example" },
    }),
    env,
  );
  assert.equal(disallowed.headers.get("x-muthur-cache"), "HIT");
  assert.equal(disallowed.headers.get("access-control-allow-origin"), null);
});

test("rejects unknown routes and disallowed preflight origins", async () => {
  const handler = createHandler({ fetchImpl: mockFetch(), cache: null });
  const missing = await handler(new Request("https://worker.example/unknown"), env);
  assert.equal(missing.status, 404);
  const preflight = await handler(
    new Request("https://worker.example/bulletins", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example" },
    }),
    env,
  );
  assert.equal(preflight.status, 403);
});
