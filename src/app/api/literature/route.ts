import { NextRequest, NextResponse } from "next/server";
import type { LiteratureRequest, LiteratureResponse } from "@/types/api";
import type { LiteratureResult } from "@/types/session";
import { generateId } from "@/lib/utils";

// Semantic Scholar API base URL
const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1";

// Simple in-memory cache (in production, use Redis or similar)
const cache = new Map<string, { data: LiteratureResult[]; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Disciplines that are considered cross-disciplinary for Management
const CROSS_DISCIPLINARY_FIELDS = [
  "Sociology",
  "Economics",
  "Psychology",
  "Political Science",
  "Anthropology",
  "Philosophy",
];

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  year?: number;
  authors?: { name: string }[];
  citationCount?: number;
  url?: string;
  fieldsOfStudy?: string[];
  externalIds?: {
    DOI?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: LiteratureRequest = await request.json();
    const { query, subfield, limit = 5 } = body;

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: "validation_error", message: "Search query is required" },
        { status: 400 }
      );
    }

    // Check cache
    const cacheKey = `${query.toLowerCase()}_${subfield || "all"}_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const response: LiteratureResponse = {
        papers: cached.data,
        totalFound: cached.data.length,
        cached: true,
      };
      return NextResponse.json(response);
    }

    // Build search query
    let searchQuery = query;
    if (subfield) {
      searchQuery = `${query} ${subfield}`;
    }

    // Call Semantic Scholar API
    const apiUrl = new URL(`${SEMANTIC_SCHOLAR_API}/paper/search`);
    apiUrl.searchParams.set("query", searchQuery);
    apiUrl.searchParams.set("limit", String(Math.min(limit, 10)));
    apiUrl.searchParams.set(
      "fields",
      "paperId,title,abstract,year,authors,citationCount,url,fieldsOfStudy,externalIds"
    );

    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Add API key if available (for higher rate limits)
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
      headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    }

    const response = await fetch(apiUrl.toString(), { headers });

    if (!response.ok) {
      if (response.status === 429) {
        return NextResponse.json(
          {
            error: "rate_limit",
            message: "Literature search rate limit reached. Please wait a moment and try again.",
          },
          { status: 429 }
        );
      }
      throw new Error(`Semantic Scholar API error: ${response.status}`);
    }

    const data = await response.json();
    const papers: SemanticScholarPaper[] = data.data || [];

    // Transform to our format
    const results: LiteratureResult[] = papers.map((paper) => {
      const discipline = paper.fieldsOfStudy?.[0] || "Unknown";
      const isCrossDisciplinary = CROSS_DISCIPLINARY_FIELDS.some(
        (field) =>
          paper.fieldsOfStudy?.some(
            (f) => f.toLowerCase().includes(field.toLowerCase())
          )
      );

      return {
        id: generateId(),
        paperId: paper.paperId,
        title: paper.title,
        authors: paper.authors?.map((a) => a.name) || [],
        year: paper.year || 0,
        abstract: paper.abstract,
        url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
        citationCount: paper.citationCount,
        isCrossDisciplinary,
        discipline: isCrossDisciplinary ? discipline : undefined,
      };
    });

    // Cache results
    cache.set(cacheKey, { data: results, timestamp: Date.now() });

    // Clean old cache entries periodically
    if (cache.size > 100) {
      const now = Date.now();
      for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          cache.delete(key);
        }
      }
    }

    const literatureResponse: LiteratureResponse = {
      papers: results,
      totalFound: data.total || results.length,
      cached: false,
    };

    return NextResponse.json(literatureResponse);
  } catch (error) {
    console.error("Literature API error:", error);
    return NextResponse.json(
      {
        error: "literature_error",
        message: "Failed to search literature. Please try again.",
      },
      { status: 500 }
    );
  }
}
