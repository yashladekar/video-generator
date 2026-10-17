import { ProviderError } from "../../lib/errors";
import { fetchJson } from "../http";
import { configNumber, configString, secretValue } from "../resolve";
import type {
  ProviderCallContext,
  ResearchOutput,
  ResearchProvider,
  ResearchSource,
  ResolvedProvider,
} from "../types";

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

type WikiSearchResponse = {
  query?: {
    search?: Array<{ title: string; snippet: string; pageid?: number }>;
  };
};

type WikiSummaryResponse = {
  title?: string;
  extract?: string;
  description?: string;
  content_urls?: { desktop?: { page?: string } };
};

export const wikipediaResearchProvider: ResearchProvider = {
  provider: "wikipedia",
  async research(
    topic: string,
    _resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ResearchOutput> {
    const baseUrl = configString(
      _resolved,
      "baseUrl",
      "https://en.wikipedia.org",
    )!;
    const searchUrl = new URL("/w/api.php", baseUrl);
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srsearch", topic);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("utf8", "1");
    searchUrl.searchParams.set("srlimit", "3");

    const search = await fetchJson<WikiSearchResponse>(
      searchUrl.toString(),
      {
        headers: {
          "User-Agent":
            "VideoGenerator/1.0 (local research; contact: local-app)",
          Accept: "application/json",
        },
      },
      { provider: "wikipedia", signal: ctx.signal, timeoutMs: 30_000 },
    );

    const results = search.data.query?.search ?? [];
    const sources: ResearchSource[] = [];
    const summaries: string[] = [];

    for (const result of results.slice(0, 2)) {
      try {
        const summaryUrl = new URL(
          `/api/rest_v1/page/summary/${encodeURIComponent(result.title)}`,
          baseUrl,
        );
        const summary = await fetchJson<WikiSummaryResponse>(
          summaryUrl.toString(),
          {
            headers: {
              "User-Agent":
                "VideoGenerator/1.0 (local research; contact: local-app)",
              Accept: "application/json",
            },
          },
          { provider: "wikipedia", signal: ctx.signal, timeoutMs: 30_000 },
        );
        const extract = summary.data.extract?.trim();
        if (extract) summaries.push(extract.slice(0, 1200));
        sources.push({
          title: summary.data.title ?? result.title,
          url:
            summary.data.content_urls?.desktop?.page ??
            `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title)}`,
          snippet: stripHtml(result.snippet),
        });
      } catch {
        sources.push({
          title: result.title,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title)}`,
          snippet: stripHtml(result.snippet),
        });
      }
    }

    return {
      summary: summaries.join("\n\n"),
      sources,
      usage: { unit: "request", inputUnits: 1, estimatedCostUsd: 0, actualCostUsd: 0 },
    };
  },
};

type TavilyResponse = {
  answer?: string;
  results?: Array<{ title?: string; url?: string; content?: string }>;
};

export const tavilyResearchProvider: ResearchProvider = {
  provider: "tavily",
  async research(
    topic: string,
    resolved: ResolvedProvider,
    ctx: ProviderCallContext,
  ): Promise<ResearchOutput> {
    const apiKey = secretValue(resolved, "apiKey", ctx.env.TAVILY_API_KEY);
    if (!apiKey) {
      throw new ProviderError(
        "PROVIDER_AUTH",
        "No API key configured for Tavily",
        { provider: "tavily", kind: "PROVIDER_PERMANENT" },
      );
    }
    const maxResults = configNumber(resolved, "maxResults", 5) ?? 5;
    const response = await fetchJson<TavilyResponse>(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: topic,
          search_depth: "basic",
          max_results: maxResults,
          include_answer: true,
        }),
      },
      { provider: "tavily", signal: ctx.signal, timeoutMs: 60_000 },
    );
    const sources: ResearchSource[] = (response.data.results ?? []).map(
      (result) => ({
        title: result.title ?? "Untitled",
        url: result.url ?? "",
        snippet: result.content?.slice(0, 400),
      }),
    );
    return {
      summary:
        response.data.answer?.trim() ||
        sources.map((source) => source.snippet ?? "").filter(Boolean).join("\n\n"),
      sources,
      usage: { unit: "request", inputUnits: 1 },
    };
  },
};
