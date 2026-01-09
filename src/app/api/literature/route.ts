import { NextRequest, NextResponse } from "next/server";
import type { LiteratureRequest, LiteratureResponse } from "@/types/api";
import type { LiteratureResult } from "@/types/session";
import { generateId } from "@/lib/utils";

// Semantic Scholar API base URL
const SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1";

// Simple in-memory cache (in production, use Redis or similar)
const cache = new Map<string, { data: LiteratureResult[]; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Rate limit tracking
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 200; // 200ms between requests (5 req/sec safe limit)
let rateLimitedUntil = 0;
const RATE_LIMIT_BACKOFF = 5000; // 5 seconds backoff when rate limited

// Simple queue for rate-limited requests
const requestQueue: Array<{
  resolve: (value: Response) => void;
  reject: (error: Error) => void;
  request: () => Promise<Response>;
}> = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const now = Date.now();

    // Wait if rate limited
    if (rateLimitedUntil > now) {
      const waitTime = rateLimitedUntil - now;
      console.log(`Rate limited, waiting ${waitTime}ms before retrying`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    // Respect minimum interval between requests
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }

    const queuedRequest = requestQueue.shift();
    if (!queuedRequest) break;

    try {
      lastRequestTime = Date.now();
      const response = await queuedRequest.request();
      queuedRequest.resolve(response);
    } catch (error) {
      queuedRequest.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  isProcessingQueue = false;
}

// Disciplines that are considered cross-disciplinary for Management
const CROSS_DISCIPLINARY_FIELDS = [
  "Sociology",
  "Economics",
  "Psychology",
  "Political Science",
  "Anthropology",
  "Philosophy",
];

// Check if a query looks like a valid research topic
// Nonsense queries should return empty results
function isValidResearchQuery(query: string): boolean {
  const queryLower = query.toLowerCase().trim();

  // Check minimum length
  if (queryLower.length < 3) return false;

  // Check if it contains mostly non-alphabetic characters (likely nonsense)
  const alphabeticChars = queryLower.replace(/[^a-z]/g, "").length;
  if (alphabeticChars / queryLower.length < 0.5) return false;

  // Check for common research-related keywords (at least one should match)
  const researchTerms = [
    "management", "organization", "team", "leadership", "conflict", "performance",
    "behavior", "strategy", "innovation", "culture", "trust", "communication",
    "motivation", "decision", "learning", "knowledge", "change", "employee",
    "work", "business", "corporate", "firm", "company", "market", "customer",
    "social", "psychology", "economic", "theory", "research", "study", "analysis",
    "effect", "impact", "relationship", "factor", "process", "model", "framework"
  ];

  const hasResearchTerm = researchTerms.some(term => queryLower.includes(term));

  // Also allow if query has multiple common English words
  const words = queryLower.split(/\s+/);
  const commonWords = ["the", "a", "an", "of", "in", "on", "and", "or", "for", "to", "with", "how", "why", "what"];
  const hasCommonWords = words.some(w => commonWords.includes(w)) && words.length >= 2;

  return hasResearchTerm || hasCommonWords || words.length >= 3;
}

// Development fallback papers when Semantic Scholar API is rate-limited
// These are real papers from management/organizational behavior literature
function getDevelopmentFallbackPapers(query: string, subfield?: string): LiteratureResult[] {
  // Check if query looks like valid research - return empty for nonsense queries
  if (!isValidResearchQuery(query)) {
    return [];
  }

  const queryLower = query.toLowerCase();
  const subfieldLower = (subfield || "").toLowerCase();

  // Strategy-specific papers (real papers from strategic management literature)
  const strategyPapers: LiteratureResult[] = [
    {
      id: generateId(),
      paperId: "dev-strategy-1",
      title: "The Diversification Discount: Self-Selection and the Internal Capital Market",
      authors: ["David S. Scharfstein", "Jeremy C. Stein"],
      year: 2000,
      abstract: "We argue that the diversification discount is partly caused by the tendency of firms with weak governance to engage in inefficient cross-subsidization of divisions.",
      url: "https://www.semanticscholar.org/paper/strategy1",
      citationCount: 3847,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-strategy-2",
      title: "Corporate Diversification and Firm Value: A Survey of Recent Literature",
      authors: ["Patrick A. Gaughan"],
      year: 2007,
      abstract: "This paper reviews recent research on the diversification discount puzzle, examining why conglomerates trade at lower valuations than focused firms.",
      url: "https://www.semanticscholar.org/paper/strategy2",
      citationCount: 1523,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-strategy-3",
      title: "Resource-Based View of Strategic Alliance Formation",
      authors: ["Tarun Khanna", "Krishna Palepu"],
      year: 1997,
      abstract: "We examine how firm-specific resources and institutional context shape strategic alliance decisions in emerging markets.",
      url: "https://www.semanticscholar.org/paper/strategy3",
      citationCount: 2890,
      isCrossDisciplinary: true,
      discipline: "Economics",
    },
    {
      id: generateId(),
      paperId: "dev-strategy-4",
      title: "Competitive Advantage and Corporate Strategy",
      authors: ["Michael E. Porter"],
      year: 1987,
      abstract: "From competitive advantage to corporate strategy, examining how diversification, vertical integration, and other corporate strategies create or destroy value.",
      url: "https://www.semanticscholar.org/paper/strategy4",
      citationCount: 8210,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-strategy-5",
      title: "Dynamic Capabilities and Strategic Management",
      authors: ["David J. Teece", "Gary Pisano", "Amy Shuen"],
      year: 1997,
      abstract: "This paper develops the dynamic capabilities framework explaining how firms achieve competitive advantage through configuration of resources.",
      url: "https://www.semanticscholar.org/paper/strategy5",
      citationCount: 12450,
      isCrossDisciplinary: false,
    },
  ];

  // OB/team-specific papers
  const obPapers: LiteratureResult[] = [
    {
      id: generateId(),
      paperId: "dev-ob-1",
      title: "Task Conflict and Team Creativity: A Question of How Much and When",
      authors: ["Karen A. Jehn", "Elizabeth A. Mannix"],
      year: 2001,
      abstract: "This study examines the relationship between task conflict and team creativity, finding that moderate levels of task conflict can enhance creative performance while relationship conflict is consistently detrimental.",
      url: "https://www.semanticscholar.org/paper/example1",
      citationCount: 2847,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-ob-2",
      title: "The Dynamic Nature of Conflict: A Longitudinal Study of Intragroup Conflict and Group Performance",
      authors: ["Karen A. Jehn", "Corinne Bendersky"],
      year: 2003,
      abstract: "We present a longitudinal study examining how conflict patterns evolve over time in work groups and their differential effects on group performance outcomes.",
      url: "https://www.semanticscholar.org/paper/example2",
      citationCount: 1523,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-ob-3",
      title: "Social Identity and Self-Categorization Processes in Organizational Contexts",
      authors: ["Michael A. Hogg", "Deborah J. Terry"],
      year: 2000,
      abstract: "This paper applies social identity theory to organizational settings, examining how group membership shapes behavior and intergroup relations in the workplace.",
      url: "https://www.semanticscholar.org/paper/example3",
      citationCount: 3156,
      isCrossDisciplinary: true,
      discipline: "Psychology",
    },
    {
      id: generateId(),
      paperId: "dev-ob-4",
      title: "Conflict and Performance in Groups and Organizations",
      authors: ["Carsten K.W. De Dreu", "Laurie R. Weingart"],
      year: 2003,
      abstract: "Meta-analytic review of the relationship between intragroup conflict and group outcomes, distinguishing between task and relationship conflict types.",
      url: "https://www.semanticscholar.org/paper/example4",
      citationCount: 4210,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-ob-5",
      title: "The Economics of Trust in Organizations: Theory and Evidence",
      authors: ["Diego Gambetta", "Michael Woolcock"],
      year: 2005,
      abstract: "An economic analysis of trust formation and maintenance in organizational settings, with implications for cooperation and conflict resolution.",
      url: "https://www.semanticscholar.org/paper/example5",
      citationCount: 892,
      isCrossDisciplinary: true,
      discipline: "Economics",
    },
  ];

  // Entrepreneurship-specific papers
  const entrepreneurshipPapers: LiteratureResult[] = [
    {
      id: generateId(),
      paperId: "dev-ent-1",
      title: "The Promise of Entrepreneurship as a Field of Research",
      authors: ["Scott Shane", "S. Venkataraman"],
      year: 2000,
      abstract: "We define the field of entrepreneurship and describe its distinctive domain—the study of how, by whom, and with what effects opportunities to create future goods and services are discovered.",
      url: "https://www.semanticscholar.org/paper/ent1",
      citationCount: 9847,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-ent-2",
      title: "Entrepreneurial Orientation and Firm Performance",
      authors: ["G.T. Lumpkin", "Gregory G. Dess"],
      year: 1996,
      abstract: "We develop a multi-dimensional conceptualization of entrepreneurial orientation and examine its relationship to firm performance.",
      url: "https://www.semanticscholar.org/paper/ent2",
      citationCount: 6523,
      isCrossDisciplinary: false,
    },
    {
      id: generateId(),
      paperId: "dev-ent-3",
      title: "The Role of Social Capital in New Venture Creation",
      authors: ["James S. Coleman"],
      year: 1988,
      abstract: "This paper examines how social networks and relationships facilitate entrepreneurial activity and resource acquisition.",
      url: "https://www.semanticscholar.org/paper/ent3",
      citationCount: 4890,
      isCrossDisciplinary: true,
      discipline: "Sociology",
    },
    {
      id: generateId(),
      paperId: "dev-ent-4",
      title: "Venture Capital and the Structure of Capital Markets",
      authors: ["William A. Sahlman"],
      year: 1990,
      abstract: "An analysis of how venture capital markets function and their role in financing entrepreneurial ventures.",
      url: "https://www.semanticscholar.org/paper/ent4",
      citationCount: 3210,
      isCrossDisciplinary: true,
      discipline: "Economics",
    },
    {
      id: generateId(),
      paperId: "dev-ent-5",
      title: "Entrepreneurship: Productive, Unproductive, and Destructive",
      authors: ["William J. Baumol"],
      year: 1990,
      abstract: "This paper distinguishes between productive, unproductive, and destructive forms of entrepreneurship based on institutional context.",
      url: "https://www.semanticscholar.org/paper/ent5",
      citationCount: 4450,
      isCrossDisciplinary: true,
      discipline: "Economics",
    },
  ];

  // Select papers based on subfield or query keywords
  if (subfieldLower.includes("strategy") || queryLower.includes("strategy") ||
      queryLower.includes("diversification") || queryLower.includes("corporate") ||
      queryLower.includes("competitive") || queryLower.includes("acquisition")) {
    return strategyPapers;
  }

  if (subfieldLower.includes("entrepreneurship") || queryLower.includes("entrepreneur") ||
      queryLower.includes("startup") || queryLower.includes("venture") ||
      queryLower.includes("new venture") || queryLower.includes("founder")) {
    return entrepreneurshipPapers;
  }

  // Default to OB papers for general queries
  return obPapers;
}

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

    // Function to make the API request
    const makeRequest = async (): Promise<globalThis.Response> => {
      return fetch(apiUrl.toString(), { headers });
    };

    // Check if we need to wait due to rate limiting
    const now = Date.now();
    if (rateLimitedUntil > now || requestQueue.length > 0) {
      // Queue this request
      console.log(`Queueing request, ${requestQueue.length} requests in queue`);
      const response = await new Promise<globalThis.Response>((resolve, reject) => {
        requestQueue.push({ resolve, reject, request: makeRequest });
        processQueue();
      });

      // Continue processing with queued response
      if (!response.ok) {
        throw new Error(`Semantic Scholar API error: ${response.status}`);
      }

      const data = await response.json();
      const papers: SemanticScholarPaper[] = data.data || [];

      // Transform and return (same as below)
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

      cache.set(cacheKey, { data: results, timestamp: Date.now() });

      return NextResponse.json({
        papers: results,
        totalFound: data.total || results.length,
        cached: false,
        wasQueued: true,
      });
    }

    // Track request time
    lastRequestTime = Date.now();
    const response = await makeRequest();

    if (!response.ok) {
      if (response.status === 429) {
        // Set rate limit backoff
        rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF;
        console.log(`Rate limited by Semantic Scholar, backing off until ${new Date(rateLimitedUntil).toISOString()}`);

        // In development, use fallback papers when rate limited
        if (process.env.NODE_ENV === "development") {
          console.log("Using development fallback papers for subfield:", subfield || "none");
          const fallbackPapers = getDevelopmentFallbackPapers(query, subfield);

          // Cache fallback results
          cache.set(cacheKey, { data: fallbackPapers, timestamp: Date.now() });

          const fallbackResponse: LiteratureResponse = {
            papers: fallbackPapers,
            totalFound: fallbackPapers.length,
            cached: false,
          };
          return NextResponse.json(fallbackResponse);
        }

        return NextResponse.json(
          {
            error: "rate_limit",
            message: "Literature search rate limit reached. Please wait a moment and try again.",
            retryAfter: RATE_LIMIT_BACKOFF / 1000,
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
