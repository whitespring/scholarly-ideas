import { NextRequest, NextResponse } from "next/server";
import type { LiteratureRequest, LiteratureResponse } from "@/types/api";
import type { LiteratureResult, JournalTier } from "@/types/session";
import { generateId } from "@/lib/utils";
import { extractAIConfig, validateAIConfig, generateAIResponse } from "@/lib/ai/client";
import type { AIRequestConfig } from "@/types/ai-settings";

// OpenAlex API base URL
const OPENALEX_API = "https://api.openalex.org";

// Simple in-memory cache (in production, use Redis or similar)
const cache = new Map<string, { data: LiteratureResult[]; timestamp: number }>();
const queryExpansionCache = new Map<string, { terms: string[]; timestamp: number }>();
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

// ============================================================
// OpenAlex Source IDs for Quality Journal Filtering
// These IDs allow us to filter at the API level for quality journals only
// ============================================================

// UTD24 - UT Dallas Top 24 Business Journals
const UTD24_SOURCE_IDS = new Map([
  ["S117778295", "Academy of Management Journal"],
  ["S46763546", "Academy of Management Review"],
  ["S143668711", "Administrative Science Quarterly"],
  ["S102949365", "Strategic Management Journal"],
  ["S206124708", "Organization Science"],
  ["S33323087", "Management Science"],
  ["S142990027", "Journal of Marketing"],
  ["S119950638", "Journal of Marketing Research"],
  ["S145429826", "Journal of Consumer Research"],
  ["S5353659", "The Journal of Finance"],
  ["S149240962", "Journal of Financial Economics"],
  ["S57293258", "MIS Quarterly"],
  ["S142306484", "Journal of Operations Management"],
  ["S125775545", "Operations Research"],
  ["S38024979", "Journal of International Business Studies"],
  ["S202812398", "Information Systems Research"],
  ["S62142384", "Journal of Accounting and Economics"],
  ["S111116695", "Journal of Accounting Research"],
  ["S163545350", "Journal of Consumer Psychology"],
  ["S193228710", "Journal of Financial and Quantitative Analysis"],
  ["S81410195", "Manufacturing & Service Operations Management"],
  ["S163534328", "Marketing Science"],
  ["S149070780", "Production and Operations Management"],
  ["S170137484", "Review of Financial Studies"],
  ["S160506855", "The Accounting Review"],
]);

// Top Disciplinary Journals (outside management)
const TOP_DISCIPLINARY_SOURCE_IDS = new Map([
  // Economics
  ["S23254222", "American Economic Review"],
  ["S95464858", "Econometrica"],
  ["S203860005", "The Quarterly Journal of Economics"],
  ["S95323914", "Journal of Political Economy"],
  ["S88935262", "The Review of Economic Studies"],
  // Sociology
  ["S157620343", "American Sociological Review"],
  ["S122471516", "American Journal of Sociology"],
  // Psychology
  ["S166002381", "Journal of Applied Psychology"],
  ["S64744539", "Organizational Behavior and Human Decision Processes"],
  ["S35223124", "Psychological Review"],
  ["S75627607", "Psychological Bulletin"],
  ["S29984966", "Journal of Personality and Social Psychology"],
  // Political Science
  ["S176007004", "American Political Science Review"],
  ["S90314269", "American Journal of Political Science"],
  // Top Science
  ["S137773608", "Nature"],
  ["S3880285", "Science"],
  ["S125754415", "Proceedings of the National Academy of Sciences"],
  // Annual Reviews
  ["S90670110", "Annual Review of Psychology"],
  ["S61274580", "Annual Review of Sociology"],
]);

// Quality Management Journals (FT50 and respected innovation journals)
const QUALITY_MANAGEMENT_SOURCE_IDS = new Map([
  // Innovation & Technology
  ["S93630570", "Journal of Product Innovation Management"],
  ["S9731383", "Research Policy"],
  ["S39307421", "Technological Forecasting and Social Change"],
  // General Management (FT50 not in UTD24)
  ["S122767448", "Journal of Management"],
  ["S151705444", "Journal of Management Studies"],
  ["S66201313", "Journal of Business Venturing"],
  ["S76633192", "Journal of Business Ethics"],
  ["S187626162", "Entrepreneurship Theory and Practice"],
  ["S134094273", "Human Resource Management"],
  // Strategy
  ["S9435936", "Long Range Planning"],
  ["S172782825", "California Management Review"],
  ["S196034224", "MIT Sloan Management Review"],
  // Operations & Supply Chain
  ["S97320426", "Journal of Supply Chain Management"],
  ["S164321952", "International Journal of Operations & Production Management"],
]);

// UTD 24 - UT Dallas Top 24 Business Journals (Tier 1)
const UTD24_JOURNALS = new Set([
  "Academy of Management Journal",
  "Academy of Management Review",
  "Administrative Science Quarterly",
  "Information Systems Research",
  "Journal of Accounting and Economics",
  "Journal of Accounting Research",
  "Journal of Consumer Psychology",
  "Journal of Consumer Research",
  "Journal of Finance",
  "Journal of Financial Economics",
  "Journal of Financial and Quantitative Analysis",
  "Journal of International Business Studies",
  "Journal of Marketing",
  "Journal of Marketing Research",
  "Journal of Operations Management",
  "Management Science",
  "Manufacturing & Service Operations Management",
  "Marketing Science",
  "MIS Quarterly",
  "Operations Research",
  "Organization Science",
  "Production and Operations Management",
  "Review of Financial Studies",
  "Strategic Management Journal",
  "The Accounting Review",
]);

// Top Disciplinary Journals - Only the very top journals outside of management
const TOP_DISCIPLINARY_JOURNALS = new Set([
  // Economics - Top 5
  "American Economic Review",
  "Econometrica",
  "Quarterly Journal of Economics",
  "Journal of Political Economy",
  "Review of Economic Studies",
  // Sociology - Top 2
  "American Sociological Review",
  "American Journal of Sociology",
  // Psychology - Top 5
  "Journal of Applied Psychology",
  "Organizational Behavior and Human Decision Processes",
  "Psychological Review",
  "Psychological Bulletin",
  "Journal of Personality and Social Psychology",
  // Political Science - Top 2
  "American Political Science Review",
  "American Journal of Political Science",
  // Science - Top 3
  "Nature",
  "Science",
  "Proceedings of the National Academy of Sciences",
  "PNAS",
  // Annual Reviews (authoritative reviews)
  "Annual Review of Psychology",
  "Annual Review of Sociology",
  "Annual Review of Economics",
  "Annual Review of Political Science",
  "Annual Review of Organizational Psychology and Organizational Behavior",
]);

// Journal abbreviation mapping for fuzzy matching
const JOURNAL_ABBREVIATIONS: Record<string, string[]> = {
  // UTD24 journals
  "Academy of Management Journal": ["AMJ", "Acad Manage J", "Acad. Manage. J."],
  "Academy of Management Review": ["AMR", "Acad Manage Rev", "Acad. Manage. Rev."],
  "Administrative Science Quarterly": ["ASQ", "Admin Sci Q", "Admin. Sci. Q."],
  "Strategic Management Journal": ["SMJ", "Strat Manage J", "Strateg. Manag. J."],
  "Organization Science": ["Org Sci", "Organ. Sci."],
  "Management Science": ["Manage Sci", "Manag. Sci."],
  "MIS Quarterly": ["MISQ", "MIS Q"],
  "Journal of Marketing": ["JM", "J Mark", "J. Mark."],
  "Journal of Marketing Research": ["JMR", "J Mark Res", "J. Mark. Res."],
  "Journal of Consumer Research": ["JCR", "J Consum Res", "J. Consum. Res."],
  "Journal of Finance": ["JF", "J Financ", "J. Financ."],
  "Journal of Financial Economics": ["JFE", "J Financ Econ", "J. Financ. Econ."],
  "Review of Financial Studies": ["RFS", "Rev Financ Stud", "Rev. Financ. Stud."],
  "Journal of International Business Studies": ["JIBS", "J Int Bus Stud", "J. Int. Bus. Stud."],
  "Journal of Operations Management": ["JOM", "J Oper Manag", "J. Oper. Manag."],
  "Operations Research": ["OR", "Oper Res", "Oper. Res."],
  "Production and Operations Management": ["POM", "Prod Oper Manag"],
  // Top Disciplinary journals
  "American Economic Review": ["AER", "Am Econ Rev", "Am. Econ. Rev."],
  "Econometrica": ["Ecta"],
  "Quarterly Journal of Economics": ["QJE", "Q J Econ", "Q. J. Econ."],
  "Journal of Political Economy": ["JPE", "J Polit Econ", "J. Polit. Econ."],
  "Review of Economic Studies": ["RES", "Rev Econ Stud", "Rev. Econ. Stud."],
  "American Sociological Review": ["ASR", "Am Sociol Rev", "Am. Sociol. Rev."],
  "American Journal of Sociology": ["AJS", "Am J Sociol", "Am. J. Sociol."],
  "Journal of Applied Psychology": ["JAP", "J Appl Psychol", "J. Appl. Psychol."],
  "Organizational Behavior and Human Decision Processes": ["OBHDP", "Organ Behav Hum Decis Process"],
  "Journal of Personality and Social Psychology": ["JPSP", "J Pers Soc Psychol"],
  "Psychological Review": ["Psychol Rev", "Psychol. Rev."],
  "Psychological Bulletin": ["Psychol Bull", "Psychol. Bull."],
  "Psychological Science": ["Psychol Sci", "Psychol. Sci."],
  "American Political Science Review": ["APSR", "Am Polit Sci Rev"],
  "American Journal of Political Science": ["AJPS", "Am J Polit Sci"],
};

// OpenAlex API types
interface OpenAlexWork {
  id: string;
  doi?: string;
  title: string;
  display_name: string;
  publication_year: number;
  publication_date?: string;
  primary_location?: {
    source?: {
      display_name?: string;
      issn_l?: string;
      type?: string;
    };
  };
  authorships: Array<{
    author: {
      id: string;
      display_name: string;
    };
    institutions: Array<{
      display_name: string;
    }>;
  }>;
  cited_by_count: number;
  abstract_inverted_index?: Record<string, number[]>;
  concepts: Array<{
    id: string;
    display_name: string;
    level: number;
    score: number;
  }>;
  open_access?: {
    is_oa: boolean;
    oa_url?: string;
  };
}

interface OpenAlexResponse {
  meta: {
    count: number;
    page: number;
    per_page: number;
  };
  results: OpenAlexWork[];
}

// Reconstruct abstract from OpenAlex inverted index format
function reconstructAbstract(invertedIndex: Record<string, number[]> | null | undefined): string | null {
  if (!invertedIndex) return null;

  // Find max position to size the array
  let maxPos = 0;
  for (const positions of Object.values(invertedIndex)) {
    for (const pos of positions) {
      if (pos > maxPos) maxPos = pos;
    }
  }

  // Create array and place words at their positions
  const words: string[] = new Array(maxPos + 1).fill('');
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }

  return words.join(' ');
}

// Query expansion using AI to convert conceptual queries into targeted search terms
async function expandQuery(query: string, aiConfig: AIRequestConfig): Promise<string[]> {
  const normalizedQuery = query.toLowerCase().trim();

  // Check cache first
  const cached = queryExpansionCache.get(normalizedQuery);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[Query Expansion] Cache hit for: "${query}"`);
    return cached.terms;
  }

  // Skip expansion for short, targeted queries (likely already good keywords)
  if (query.split(" ").length <= 3) {
    console.log(`[Query Expansion] Short query, skipping expansion: "${query}"`);
    return [query];
  }

  try {
    console.log(`[Query Expansion] Expanding conceptual query: "${query}"`);
    const text = await generateAIResponse(aiConfig, {
      system: "You are an academic research assistant. Always respond with valid JSON only.",
      messages: [{
        role: "user",
        content: `Convert this conceptual research query into 3-5 targeted academic search terms for finding relevant papers in management/organizational research. Return ONLY a JSON array of strings, no explanation.

Query: "${query}"

Example input: "the tension between organizational change and inertia"
Example output: ["organizational inertia", "resistance to change", "organizational adaptation", "change management"]`
      }],
      maxTokens: 200,
    });

    const terms = JSON.parse(text);

    if (Array.isArray(terms) && terms.length > 0) {
      const expandedTerms = terms.slice(0, 5);
      console.log(`[Query Expansion] Expanded to: ${JSON.stringify(expandedTerms)}`);

      // Cache the expanded terms
      queryExpansionCache.set(normalizedQuery, { terms: expandedTerms, timestamp: Date.now() });

      return expandedTerms;
    }

    return [query]; // Fallback to original query
  } catch (error) {
    console.error("[Query Expansion] Error:", error);
    return [query]; // Fallback to original query if expansion fails
  }
}

// ============================================================
// 3-TIER SEARCH TERM GENERATION
// Tier 1: Synonyms (same meaning, different words)
// Tier 2: Abstract context (same constructs, different context)
// Tier 3: Foundational theories (theoretical mechanisms)
// ============================================================

// Tier 1: Generate synonym phrases (same meaning, different words)
async function generateTier1Terms(query: string, aiConfig: AIRequestConfig): Promise<string[]> {
  try {
    console.log(`[Tier 1] Generating synonyms for: "${query}"`);
    const text = await generateAIResponse(aiConfig, {
      system: "You are an academic research assistant. Always respond with valid JSON only.",
      messages: [{
        role: "user",
        content: `Generate 3-5 synonym phrases for this research topic.
These should mean the SAME THING using different words.
Do NOT broaden or abstract - keep exact same meaning.

Query: "${query}"

Examples:
- "team breakups" → ["team dissolution", "team separation", "team splits"]
- "knowledge transfer" → ["knowledge sharing", "knowledge exchange"]
- "organizational change resistance" → ["resistance to change", "employee change resistance"]

Return ONLY a JSON array of strings.`
      }],
      maxTokens: 200,
    });

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const terms = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    if (Array.isArray(terms) && terms.length > 0) {
      console.log(`[Tier 1] Generated: ${JSON.stringify(terms.slice(0, 5))}`);
      return terms.slice(0, 5);
    }
    return [];
  } catch (error) {
    console.error("[Tier 1] Error:", error);
    return [];
  }
}

// Tier 2: Abstract context but keep constructs/relationships intact
async function generateTier2Terms(query: string, tier1Terms: string[], aiConfig: AIRequestConfig): Promise<string[]> {
  try {
    console.log(`[Tier 2] Generating context-abstracted terms for: "${query}"`);
    const text = await generateAIResponse(aiConfig, {
      system: "You are an academic research assistant. Always respond with valid JSON only.",
      messages: [{
        role: "user",
        content: `Generate 3-5 search terms that study the SAME CONSTRUCTS/RELATIONSHIPS but in DIFFERENT CONTEXTS.

Original query: "${query}"
Already searched: ${JSON.stringify(tier1Terms)}

Abstract the context (industry, setting, population) but keep the core ideas/relationships intact.

Examples:
- "entrepreneurial team breakups" → ["organizational team dissolution", "partnership breakup", "co-founder exits", "business partner separation"]
- "startup innovation" → ["firm innovation", "organizational innovation", "SME innovation"]
- "family firm succession" → ["organizational succession", "leadership succession", "CEO succession"]

Return ONLY a JSON array of strings.`
      }],
      maxTokens: 200,
    });

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const terms = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    if (Array.isArray(terms) && terms.length > 0) {
      console.log(`[Tier 2] Generated: ${JSON.stringify(terms.slice(0, 5))}`);
      return terms.slice(0, 5);
    }
    return [];
  } catch (error) {
    console.error("[Tier 2] Error:", error);
    return [];
  }
}

// Tier 3: Abstract to foundational theories and mechanisms
async function generateTier3Terms(query: string, tier1Terms: string[], tier2Terms: string[], aiConfig: AIRequestConfig): Promise<string[]> {
  try {
    console.log(`[Tier 3] Generating foundational theory terms for: "${query}"`);
    const text = await generateAIResponse(aiConfig, {
      system: "You are an academic research assistant. Always respond with valid JSON only.",
      messages: [{
        role: "user",
        content: `Generate 3-5 search terms for FOUNDATIONAL THEORIES that help understand the mechanisms underlying this topic.

Original query: "${query}"
Already searched: ${JSON.stringify([...tier1Terms, ...tier2Terms])}

Focus on theoretical frameworks, foundational constructs, and established research streams that illuminate WHY the phenomenon occurs.

Examples:
- "entrepreneurial team breakups" → ["relationship dissolution theory", "team conflict dynamics", "organizational exit processes", "social exchange breakdown"]
- "startup failure" → ["organizational decline", "liability of newness", "resource dependence theory"]
- "knowledge transfer barriers" → ["absorptive capacity", "organizational learning theory", "knowledge stickiness"]

Return ONLY a JSON array of strings.`
      }],
      maxTokens: 200,
    });

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const terms = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    if (Array.isArray(terms) && terms.length > 0) {
      console.log(`[Tier 3] Generated: ${JSON.stringify(terms.slice(0, 5))}`);
      return terms.slice(0, 5);
    }
    return [];
  } catch (error) {
    console.error("[Tier 3] Error:", error);
    return [];
  }
}

// Analyze literature to surface research puzzles
async function analyzeLiteratureForPuzzles(
  papers: LiteratureResult[],
  originalQuery: string,
  aiConfig: AIRequestConfig,
  subfield?: string
): Promise<string> {
  if (papers.length === 0) return "";

  // Only analyze papers that have abstracts
  const papersWithAbstracts = papers.filter(p => p.abstract);
  if (papersWithAbstracts.length === 0) {
    console.log("[Literature Analysis] No papers with abstracts available");
    return "";
  }

  try {
    console.log(`[Literature Analysis] Analyzing ${papersWithAbstracts.length} papers for puzzles`);

    // Build context from papers with abstracts
    const papersContext = papersWithAbstracts
      .slice(0, 5)
      .map(p => `**${p.title}** (${p.authors.slice(0, 2).join(", ")}${p.authors.length > 2 ? " et al." : ""}, ${p.year})
Journal: ${p.journal || "Unknown"} ${p.journalTier ? `[${p.journalTier}]` : ""}
Citations: ${p.citationCount || 0}
Abstract: ${p.abstract}`)
      .join("\n\n---\n\n");

    const analysis = await generateAIResponse(aiConfig, {
      system: `You are a research methodology expert helping a ${subfield || "management"} scholar discover research puzzles.`,
      messages: [{
        role: "user",
        content: `The researcher searched for: "${originalQuery}"

Here are the most relevant papers found:

${papersContext}

Based on these papers, provide a thoughtful analysis (3-4 paragraphs) that:
1. Identifies the main themes and debates across these papers
2. Highlights gaps, tensions, contradictions, or unanswered questions in the literature
3. Suggests potential research puzzles that emerge from this literature - identify as many as genuinely emerge, not limited to any specific number

End with an open question to help the researcher think about how their interest relates to or challenges this existing work.

Keep your response focused and actionable - this should spark thinking, not overwhelm.`
      }],
      maxTokens: 1200,
    });

    console.log(`[Literature Analysis] Generated ${analysis.length} character analysis`);
    return analysis;
  } catch (error) {
    console.error("[Literature Analysis] Error:", error);
    return ""; // Return empty string on error - papers will still be returned
  }
}

// Function to normalize journal name for comparison
function normalizeJournalName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "") // Remove leading "The"
    .replace(/[&]/g, "and") // Normalize ampersand
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " "); // Normalize whitespace
}

// Build reverse lookup from abbreviation to full name (lazy init)
let abbreviationToFull: Map<string, string> | null = null;
function getAbbreviationToFull(): Map<string, string> {
  if (!abbreviationToFull) {
    abbreviationToFull = new Map();
    for (const [fullName, abbrevs] of Object.entries(JOURNAL_ABBREVIATIONS)) {
      for (const abbrev of abbrevs) {
        abbreviationToFull.set(normalizeJournalName(abbrev), fullName);
      }
    }
  }
  return abbreviationToFull;
}

// Function to check if two journal names match
function journalNamesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeJournalName(name1);
  const n2 = normalizeJournalName(name2);

  // Exact match after normalization
  if (n1 === n2) return true;

  // Check if either name is a known abbreviation
  const abbrevMap = getAbbreviationToFull();
  const fullName1 = abbrevMap.get(n1);
  const fullName2 = abbrevMap.get(n2);

  if (fullName1 && normalizeJournalName(fullName1) === n2) return true;
  if (fullName2 && normalizeJournalName(fullName2) === n1) return true;
  if (fullName1 && fullName2 && fullName1 === fullName2) return true;

  // One contains the other, but only if the shorter one is reasonably long
  const shorter = n1.length < n2.length ? n1 : n2;
  const longer = n1.length < n2.length ? n2 : n1;

  // Only allow substring match if shorter name is at least 15 chars
  if (shorter.length >= 15 && longer.includes(shorter)) {
    return true;
  }

  // Check if shorter name matches at the start of longer name
  if (longer.startsWith(shorter + " ") || longer === shorter) {
    return true;
  }

  return false;
}

// Function to determine journal tier
function getJournalTier(journalName: string | undefined): JournalTier {
  if (!journalName) return "Other";

  // Check each tier in priority order
  for (const utd of Array.from(UTD24_JOURNALS)) {
    if (journalNamesMatch(journalName, utd)) {
      return "UTD24";
    }
  }

  for (const disc of Array.from(TOP_DISCIPLINARY_JOURNALS)) {
    if (journalNamesMatch(journalName, disc)) {
      return "Top Disciplinary";
    }
  }

  return "Other";
}

// Function to get tier priority for sorting (lower = higher priority)
function getTierPriority(tier: JournalTier): number {
  switch (tier) {
    case "UTD24": return 1;
    case "Top Disciplinary": return 2;
    case "Quality Management": return 3;
    case "Other": return 4;
  }
}

// Search OpenAlex API with optional source ID filtering and citation threshold
async function searchOpenAlex(
  query: string,
  limit: number = 25,
  sourceIds?: string[],
  minCitations: number = 10
): Promise<OpenAlexWork[]> {
  // Use polite pool by including email
  const email = process.env.OPENALEX_EMAIL || "scholarly-ideas@example.com";

  const apiUrl = new URL(`${OPENALEX_API}/works`);
  apiUrl.searchParams.set("search", query);
  apiUrl.searchParams.set("per_page", String(limit));
  apiUrl.searchParams.set("mailto", email);

  // Build filter - filter for articles with configurable citation threshold
  let filter = `type:article${minCitations > 0 ? `,cited_by_count:>${minCitations}` : ""}`;

  // Add source ID filter if provided (restricts to specific journals)
  if (sourceIds && sourceIds.length > 0) {
    const sourceFilter = sourceIds.join("|");
    filter += `,primary_location.source.id:${sourceFilter}`;
  }

  apiUrl.searchParams.set("filter", filter);
  // Sort by relevance to the search query (most relevant first)
  apiUrl.searchParams.set("sort", "relevance_score:desc");

  const sourceCount = sourceIds?.length || "all";
  console.log(`[OpenAlex] Searching: "${query}" in ${sourceCount} sources`);

  try {
    const response = await fetch(apiUrl.toString());

    if (!response.ok) {
      console.error(`[OpenAlex] Error: ${response.status}`);
      return [];
    }

    const data: OpenAlexResponse = await response.json();
    console.log(`[OpenAlex] Found ${data.results.length} results (${data.meta.count} total)`);

    return data.results;
  } catch (error) {
    console.error("[OpenAlex] Fetch error:", error);
    return [];
  }
}

// Extended work type with tier tag
interface TaggedOpenAlexWork extends OpenAlexWork {
  __tier?: JournalTier;
}

// Search across all quality journal tiers with configurable citation threshold
async function searchWithTieredJournals(
  query: string,
  limit: number,
  minCitations: number = 10
): Promise<TaggedOpenAlexWork[]> {
  const allWorks: TaggedOpenAlexWork[] = [];
  const seenIds = new Set<string>();

  // Helper to add works with deduplication
  const addWorks = (works: OpenAlexWork[], tier: JournalTier) => {
    for (const work of works) {
      if (!seenIds.has(work.id)) {
        seenIds.add(work.id);
        (work as TaggedOpenAlexWork).__tier = tier;
        allWorks.push(work as TaggedOpenAlexWork);
      }
    }
  };

  // Search each tier in parallel for better performance
  const [utd24Works, topDiscWorks, qualityWorks] = await Promise.all([
    searchOpenAlex(query, limit * 2, Array.from(UTD24_SOURCE_IDS.keys()), minCitations),
    searchOpenAlex(query, limit, Array.from(TOP_DISCIPLINARY_SOURCE_IDS.keys()), minCitations),
    searchOpenAlex(query, limit, Array.from(QUALITY_MANAGEMENT_SOURCE_IDS.keys()), minCitations),
  ]);

  // Add results in tier priority order
  addWorks(utd24Works, "UTD24");
  addWorks(topDiscWorks, "Top Disciplinary");
  addWorks(qualityWorks, "Quality Management");

  console.log(`[OpenAlex] Total from quality journals: ${allWorks.length} (UTD24: ${utd24Works.length}, TopDisc: ${topDiscWorks.length}, Quality: ${qualityWorks.length})`);

  return allWorks;
}


// Transform OpenAlex work to LiteratureResult
function transformOpenAlexToLiteratureResult(work: OpenAlexWork): LiteratureResult {
  const journalName = work.primary_location?.source?.display_name;
  const journalTier = getJournalTier(journalName);
  const currentYear = new Date().getFullYear();
  const isClassic = (currentYear - work.publication_year > 5) && work.cited_by_count >= 500;

  // Reconstruct abstract from inverted index
  const abstract = reconstructAbstract(work.abstract_inverted_index);

  // Check for cross-disciplinary concepts
  const isCrossDisciplinary = work.concepts?.some(c =>
    CROSS_DISCIPLINARY_FIELDS.some(f =>
      c.display_name.toLowerCase().includes(f.toLowerCase())
    )
  ) || false;

  // Get primary discipline from level-0 concept
  const discipline = work.concepts?.find(c => c.level === 0)?.display_name;

  return {
    id: generateId(),
    paperId: work.id.replace("https://openalex.org/", ""),
    title: work.display_name || work.title,
    authors: work.authorships?.map(a => a.author.display_name) || [],
    year: work.publication_year,
    abstract: abstract || undefined,
    url: work.doi ? `https://doi.org/${work.doi.replace("https://doi.org/", "")}` : work.id,
    citationCount: work.cited_by_count,
    isCrossDisciplinary,
    discipline: isCrossDisciplinary ? discipline : undefined,
    journal: journalName,
    journalTier,
    isClassic,
  };
}

// Constants for classic/recent selection
const CLASSIC_CITATION_MIN = 500;   // Min citations for classic status
const CLASSIC_MIN_AGE = 5;          // Must be >5 years old for classic
const RECENT_MAX_AGE = 5;           // Papers within last 5 years = recent
const TARGET_CLASSICS = 5;          // Target number of classic papers
const TARGET_RECENT = 5;            // Target number of recent papers

// Select papers into classic and recent buckets, preserving relevance order
// Supports variable thresholds for progressive relaxation
function selectClassicsAndRecent(
  results: LiteratureResult[],
  classicCitationMin: number = CLASSIC_CITATION_MIN,
  requireQualityJournals: boolean = true
): { classics: LiteratureResult[]; recent: LiteratureResult[] } {
  const currentYear = new Date().getFullYear();

  // Filter to quality journals only (or all journals if fallback mode)
  const eligiblePapers = requireQualityJournals
    ? results.filter(p =>
        p.journalTier === "UTD24" ||
        p.journalTier === "Top Disciplinary" ||
        p.journalTier === "Quality Management"
      )
    : results;

  const classics: LiteratureResult[] = [];
  const recent: LiteratureResult[] = [];

  // Iterate in relevance order (preserved from OpenAlex)
  for (const paper of eligiblePapers) {
    const age = currentYear - paper.year;
    const isClassic = age > CLASSIC_MIN_AGE && (paper.citationCount || 0) >= classicCitationMin;
    const isRecent = age <= RECENT_MAX_AGE;

    if (isClassic && classics.length < TARGET_CLASSICS) {
      classics.push(paper);
    } else if (isRecent && recent.length < TARGET_RECENT) {
      recent.push(paper);
    }

    // Stop early if both buckets are full
    if (classics.length >= TARGET_CLASSICS && recent.length >= TARGET_RECENT) {
      break;
    }
  }

  return { classics, recent };
}

// Filter papers for relevance using Claude
// Supports relaxed mode for sparse results (includes related topics)
async function filterForRelevance(
  papers: LiteratureResult[],
  originalQuery: string,
  aiConfig: AIRequestConfig,
  maxResults: number = 30,
  relaxed: boolean = false
): Promise<LiteratureResult[]> {
  if (papers.length === 0) return papers;

  // Only filter if we have more papers than needed
  if (papers.length <= maxResults) return papers;

  // Build a sample that includes both potential classics and recent papers
  // This ensures we don't lose recent papers that might be ranked lower in relevance
  const currentYear = new Date().getFullYear();
  const potentialClassics = papers.filter(p => currentYear - p.year > CLASSIC_MIN_AGE);
  const potentialRecent = papers.filter(p => currentYear - p.year <= RECENT_MAX_AGE);

  // Take a balanced sample: up to 30 classics + up to 20 recent
  const samplePapers = [
    ...potentialClassics.slice(0, 30),
    ...potentialRecent.slice(0, 20)
  ];

  // Create a map for efficient lookup
  const papersToEvaluate = samplePapers.length > 0 ? samplePapers : papers.slice(0, 50);

  // Build a list of paper titles and abstracts to evaluate
  const paperSummaries = papersToEvaluate.map((p, i) => ({
    index: i,
    title: p.title,
    abstract: p.abstract?.slice(0, 250) || "No abstract available"
  }));

  // Different instructions for strict vs relaxed mode
  const strictInstructions = `EXCLUDE papers that:
- Are about adjacent but different topics (e.g., "technology acceptance" when searching for "organizational behavior")
- Only tangentially mention the search terms without being about them
- Are clearly from a different research domain or subfield

INCLUDE papers that:
- Directly address the core concepts in the search query
- Would be cited in a paper about the search topic`;

  const relaxedInstructions = `You MUST be VERY INCLUSIVE. We are looking for literature that could inform this research.

AIM TO INCLUDE AT LEAST 20-30 PAPERS from this list.

INCLUDE papers that:
- Are directly about the topic
- Study closely related phenomena that would inform this research
- Examine similar dynamics in related contexts (e.g., team dynamics, team conflict, team dissolution, founder relationships for "entrepreneurial team breakups")
- Come from adjacent fields that study similar constructs (e.g., relationship dissolution, partnership breakups, organizational exit)
- Are foundational theories that could explain the phenomenon

You should ONLY EXCLUDE papers that have absolutely NO connection to the research topic.
When in doubt, INCLUDE the paper.`;

  try {
    const text = await generateAIResponse(aiConfig, {
      system: "You are an academic research assistant. Always respond with valid JSON only.",
      messages: [{
        role: "user",
        content: `The user searched for: "${originalQuery}"

Evaluate these ${paperSummaries.length} papers and return ONLY a JSON array of the indices of relevant papers.

${relaxed ? relaxedInstructions : strictInstructions}

Papers:
${paperSummaries.map(p => `[${p.index}] ${p.title}\n   ${p.abstract}`).join("\n\n")}

Return ONLY a JSON array of indices, e.g., [0, 2, 5, 7]. Select up to ${maxResults} most relevant papers.`
      }],
      maxTokens: 600,
    });

    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\d,\s]*\]/);
    if (jsonMatch) {
      const indices = JSON.parse(jsonMatch[0]) as number[];
      // Map back to the actual papers from our sample (not the original array)
      const filtered = indices.slice(0, maxResults).map(i => papersToEvaluate[i]).filter(Boolean);
      console.log(`[Literature] Relevance filter: ${filtered.length}/${papersToEvaluate.length} papers kept from sample (${potentialClassics.length} potential classics, ${potentialRecent.length} potential recent)`);
      return filtered;
    }
  } catch (error) {
    console.error("[Literature] Relevance filtering error:", error);
  }

  // Fallback: return first maxResults from our balanced sample
  console.log("[Literature] Relevance filter fallback: using first papers from sample");
  return papersToEvaluate.slice(0, maxResults);
}


// Metadata about what search strategies were used
interface SearchMetadata {
  tier: 1 | 2 | 3;  // Which tier succeeded
  exactMatchFound: boolean;
  usedSynonyms: boolean;
  usedBroadening: boolean;
  relaxedCitations: boolean;
  includedNonQualityJournals: boolean;  // Always false in new system
  searchTermsUsed: string[];
  message?: string;
}

// Search result with metadata
interface SearchResult {
  classics: LiteratureResult[];
  recent: LiteratureResult[];
  allResults: LiteratureResult[];
  searchMetadata: SearchMetadata;
}

// ============================================================
// 3-TIER ABSTRACTION SEARCH
// Always stays within quality journals (UTD24 + Top Disciplinary + Quality Management)
// Returns best available results, may be <10 for truly niche topics
// ============================================================

async function searchWithTieredAbstraction(
  query: string,
  initialTerms: string[],
  aiConfig: AIRequestConfig
): Promise<SearchResult> {
  const allWorks: TaggedOpenAlexWork[] = [];
  const seenIds = new Set<string>();
  const usedTerms = new Set<string>();
  const metadata: SearchMetadata = {
    tier: 1,
    exactMatchFound: false,
    usedSynonyms: false,
    usedBroadening: false,
    relaxedCitations: false,
    includedNonQualityJournals: false,  // ALWAYS false - we never leave quality journals
    searchTermsUsed: [],
  };

  // Helper to add works with deduplication
  const addWorks = (works: TaggedOpenAlexWork[]) => {
    for (const work of works) {
      if (!seenIds.has(work.id)) {
        seenIds.add(work.id);
        allWorks.push(work);
      }
    }
  };

  // Helper to transform works to results
  const transformWorks = () => {
    return allWorks.map(work => {
      const result = transformOpenAlexToLiteratureResult(work);
      if (work.__tier) {
        result.journalTier = work.__tier;
      }
      return result;
    });
  };

  // Check if we have the full target of 5 classics AND 5 recent
  const checkSatisfied = (classics: LiteratureResult[], recent: LiteratureResult[]) => {
    return classics.length >= TARGET_CLASSICS && recent.length >= TARGET_RECENT;
  };

  // Helper to search multiple terms
  const searchTerms = async (terms: string[], minCitations: number = 10) => {
    for (const term of terms) {
      const normalizedTerm = term.toLowerCase().trim();
      if (!usedTerms.has(normalizedTerm)) {
        usedTerms.add(normalizedTerm);
        metadata.searchTermsUsed.push(term);
        const works = await searchWithTieredJournals(term, 30, minCitations);
        addWorks(works);
      }
    }
  };

  // ============================================================
  // TIER 1: Narrow Search (Exact Context + Specific Ideas)
  // Citation threshold: 500+ for classics
  // ============================================================
  console.log(`[Literature] TIER 1: Narrow search with initial terms: ${JSON.stringify(initialTerms)}`);

  // Search with initial terms
  await searchTerms(initialTerms);

  // Generate and search synonyms (same meaning, different words)
  const tier1Terms = await generateTier1Terms(query, aiConfig);
  if (tier1Terms.length > 0) {
    metadata.usedSynonyms = true;
    await searchTerms(tier1Terms);
  }

  let results = transformWorks();
  let { classics, recent } = selectClassicsAndRecent(results, 500, true);  // 500+ citations for classics

  console.log(`[Literature] TIER 1 results: ${classics.length} classics, ${recent.length} recent from ${results.length} papers`);

  if (checkSatisfied(classics, recent)) {
    metadata.exactMatchFound = true;
    metadata.tier = 1;
    console.log(`[Literature] TIER 1 satisfied - applying strict relevance filter`);
    const filtered = await filterForRelevance(results, query, aiConfig, 50, false);
    ({ classics, recent } = selectClassicsAndRecent(filtered, 500, true));
    if (checkSatisfied(classics, recent)) {
      return { classics: classics.slice(0, 5), recent: recent.slice(0, 5), allResults: filtered, searchMetadata: metadata };
    }
  }

  // ============================================================
  // TIER 2: Moderate Search (Abstract Context, Keep Ideas)
  // Citation threshold: 200+ for classics
  // ============================================================
  console.log(`[Literature] TIER 2: Abstracting context...`);
  metadata.tier = 2;
  metadata.usedBroadening = true;

  const tier2Terms = await generateTier2Terms(query, tier1Terms, aiConfig);
  if (tier2Terms.length > 0) {
    await searchTerms(tier2Terms);
  }

  results = transformWorks();
  ({ classics, recent } = selectClassicsAndRecent(results, 200, true));  // 200+ citations for classics

  console.log(`[Literature] TIER 2 results: ${classics.length} classics, ${recent.length} recent from ${results.length} papers`);

  if (checkSatisfied(classics, recent)) {
    console.log(`[Literature] TIER 2 satisfied - applying moderate relevance filter`);
    const filtered = await filterForRelevance(results, query, aiConfig, 50, true);  // relaxed filter
    ({ classics, recent } = selectClassicsAndRecent(filtered, 200, true));
    if (checkSatisfied(classics, recent)) {
      metadata.message = `I found literature by broadening the context while maintaining focus on the core ideas.`;
      return { classics: classics.slice(0, 5), recent: recent.slice(0, 5), allResults: filtered, searchMetadata: metadata };
    }
  }

  // ============================================================
  // TIER 3: Broad Search (Foundational Theories)
  // Citation threshold: 100+ for classics
  // ============================================================
  console.log(`[Literature] TIER 3: Searching foundational theories...`);
  metadata.tier = 3;
  metadata.relaxedCitations = true;

  const tier3Terms = await generateTier3Terms(query, tier1Terms, tier2Terms, aiConfig);
  if (tier3Terms.length > 0) {
    await searchTerms(tier3Terms);
  }

  // Also re-search key terms with lower citation threshold
  const keyTerms = [...initialTerms, ...tier1Terms.slice(0, 2)];
  for (const term of keyTerms) {
    // Search with lower citation threshold (may find different papers)
    const works = await searchWithTieredJournals(term, 30, 1);
    addWorks(works);
  }

  results = transformWorks();
  ({ classics, recent } = selectClassicsAndRecent(results, 100, true));  // 100+ citations for classics

  console.log(`[Literature] TIER 3 results: ${classics.length} classics, ${recent.length} recent from ${results.length} papers`);

  // Apply relaxed relevance filter
  const filtered = await filterForRelevance(results, query, aiConfig, 50, true);
  ({ classics, recent } = selectClassicsAndRecent(filtered, 100, true));

  // Generate appropriate message based on final results
  if (checkSatisfied(classics, recent)) {
    metadata.message = `I found foundational literature that helps understand the theoretical mechanisms underlying this topic.`;
  } else if (classics.length > 0 || recent.length > 0) {
    const total = classics.length + recent.length;
    metadata.message = `This appears to be an emerging or niche research area. I found ${total} quality papers (${classics.length} foundational, ${recent.length} recent) from top journals. Consider this an opportunity for original contribution.`;
  } else {
    metadata.message = `I couldn't find papers on "${query}" in quality journals. This may be a novel research area or try using more established academic terminology.`;
  }

  console.log(`[Literature] Final: ${classics.length} classics, ${recent.length} recent from ${filtered.length} filtered (${results.length} total)`);
  console.log(`[Literature] Search metadata: tier=${metadata.tier}, terms=${metadata.searchTermsUsed.length}`);

  return {
    classics: classics.slice(0, 5),
    recent: recent.slice(0, 5),
    allResults: filtered,
    searchMetadata: metadata
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: LiteratureRequest = await request.json();
    const { query, subfield, limit = 10 } = body;

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: "validation_error", message: "Search query is required" },
        { status: 400 }
      );
    }

    // Extract and validate AI configuration from request headers
    const aiConfig = extractAIConfig(request);
    const validation = validateAIConfig(aiConfig);

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "configuration_error",
          message: validation.error || "Invalid AI configuration. Please check your settings.",
          requiresSetup: validation.requiresSetup,
        },
        { status: 503 }
      );
    }

    // Check cache
    const cacheKey = `openalex_${query.toLowerCase()}_${subfield || "all"}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      // Re-analyze even cached results
      const analysis = await analyzeLiteratureForPuzzles(cached.data, query, aiConfig, subfield);
      // Re-select classics/recent from cached data
      const { classics, recent } = selectClassicsAndRecent(cached.data);
      const response: LiteratureResponse = {
        papers: [...classics, ...recent],
        classics,
        recent,
        totalFound: cached.data.length,
        cached: true,
        analysis: analysis || undefined,
      };
      return NextResponse.json(response);
    }

    // Expand conceptual queries
    const searchTerms = await expandQuery(query, aiConfig);

    // Search with 3-tier abstraction to find papers (quality journals only)
    const { classics, recent, allResults, searchMetadata } = await searchWithTieredAbstraction(query, searchTerms, aiConfig);
    const finalResults = [...classics, ...recent];

    // Log abstract availability
    const withAbstracts = finalResults.filter(r => r.abstract);
    const abstractPct = finalResults.length > 0 ? Math.round(withAbstracts.length / finalResults.length * 100) : 0;
    console.log(`[Literature] Papers with abstracts: ${withAbstracts.length}/${finalResults.length} (${abstractPct}%)`);

    // Cache all results (not just final selection) for potential re-selection
    cache.set(cacheKey, { data: allResults, timestamp: Date.now() });

    // Clean up old cache entries
    if (cache.size > 100) {
      const now = Date.now();
      for (const [key, value] of Array.from(cache.entries())) {
        if (now - value.timestamp > CACHE_TTL) {
          cache.delete(key);
        }
      }
    }

    // Analyze for puzzles (only if we have results)
    const analysis = finalResults.length > 0
      ? await analyzeLiteratureForPuzzles(finalResults, query, aiConfig, subfield)
      : "";

    const literatureResponse: LiteratureResponse = {
      papers: finalResults,
      classics,
      recent,
      totalFound: allResults.length,
      cached: false,
      analysis: analysis || undefined,
      searchMetadata,
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
