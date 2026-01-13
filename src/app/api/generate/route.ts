import { NextRequest, NextResponse } from "next/server";
import { extractAIConfig, validateAIConfig, generateAIResponse } from "@/lib/ai/client";
import type { Message, LiteratureResult, AnalysisResult } from "@/types/session";

interface GenerateRequest {
  outputType: "statement" | "introduction" | "brief";
  messages: Message[];
  literatureFindings: LiteratureResult[];
  analysisResults: AnalysisResult[];
  subfield?: string;
}

interface GenerateResponse {
  content: string;
  outputType: string;
  sections?: Record<string, string>;
}

// System prompts for different output types
const systemPrompts = {
  statement: `You are an expert academic writing assistant helping researchers articulate their research puzzles.

Based on the conversation, generate a polished 1-2 paragraph PUZZLE STATEMENT that could serve as the opening of a research paper introduction.

The statement should:
1. Clearly describe the empirical pattern or observation that is puzzling
2. Explain what existing theory would predict and why this observation is surprising
3. Articulate why this discrepancy matters for theory and/or practice
4. Be written in polished academic prose suitable for a top management journal

Do NOT include any preamble or explanation - just provide the puzzle statement directly.`,

  introduction: `You are an expert academic writing assistant helping researchers draft paper introductions.

Based on the conversation, generate a 2-3 page INTRODUCTION DRAFT for an academic paper.

The introduction should follow this structure:
1. Opening hook that establishes the puzzle (1-2 paragraphs)
2. Brief review of relevant literature and theoretical predictions (2-3 paragraphs)
3. Clear statement of how the empirical pattern contradicts these predictions (1 paragraph)
4. Why this puzzle matters - theoretical and practical implications (1-2 paragraphs)
5. Brief preview of the paper's approach and contributions (1 paragraph)

Write in polished academic prose suitable for a top management journal. Use a generic style that could be adapted to any journal.

Do NOT include any preamble or explanation - just provide the introduction draft directly.`,

  brief: `You are an expert academic writing assistant helping researchers create comprehensive research briefs.

Based on the conversation, generate a RESEARCH BRIEF with the following 5 sections:

## 1. The Puzzle
A clear, concise statement of the empirical pattern that contradicts or cannot be explained by existing theory. (2-3 paragraphs)

## 2. Why It Matters
Theoretical and practical significance of resolving this puzzle. What would we learn? What would change? (2-3 paragraphs)

## 3. Key Related Papers
Summary of the most relevant existing literature and how this puzzle relates to ongoing scholarly conversations. (List 3-5 papers with brief annotations)

## 4. Evidence Needed
What data or evidence would be needed to convincingly address this puzzle? What would constitute a strong test? (2-3 paragraphs)

## 5. Suggested Approach
Preliminary thoughts on methodology, data sources, and research design that could address this puzzle. (2-3 paragraphs)

Write in polished academic prose. Each section should be substantive and actionable.

Do NOT include any preamble or explanation - just provide the research brief directly.`,
};

function buildContext(
  messages: Message[],
  literatureFindings: LiteratureResult[],
  analysisResults: AnalysisResult[],
  subfield?: string
): string {
  let context = "";

  // Add subfield context
  if (subfield) {
    context += `Research Subfield: ${subfield}\n\n`;
  }

  // Add conversation history
  context += "=== CONVERSATION HISTORY ===\n";
  for (const msg of messages) {
    const role = msg.role === "user" ? "RESEARCHER" : "ASSISTANT";
    context += `${role}: ${msg.content}\n\n`;
  }

  // Add literature context
  if (literatureFindings.length > 0) {
    context += "\n=== RELEVANT LITERATURE ===\n";
    for (const paper of literatureFindings) {
      context += `- ${paper.title} (${paper.authors.slice(0, 2).join(", ")}${paper.authors.length > 2 ? " et al." : ""}, ${paper.year})`;
      if (paper.isCrossDisciplinary) {
        context += ` [${paper.discipline}]`;
      }
      context += "\n";
      if (paper.abstract) {
        context += `  Abstract: ${paper.abstract.slice(0, 200)}...\n`;
      }
    }
  }

  // Add analysis context
  if (analysisResults.length > 0) {
    context += "\n=== DATA ANALYSIS RESULTS ===\n";
    for (const result of analysisResults) {
      context += `${result.type.toUpperCase()}: ${result.summary}\n`;
    }
  }

  return context;
}

export async function POST(request: NextRequest) {
  try {
    const body: GenerateRequest = await request.json();
    const { outputType, messages, literatureFindings, analysisResults, subfield } = body;

    // Validate output type
    if (!["statement", "introduction", "brief"].includes(outputType)) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid output type" },
        { status: 400 }
      );
    }

    // Validate messages
    if (!messages || messages.length < 2) {
      return NextResponse.json(
        {
          error: "validation_error",
          message: "Please have a conversation about your research puzzle before generating output.",
        },
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

    // Build context from conversation and findings
    const context = buildContext(messages, literatureFindings, analysisResults, subfield);

    // Call AI API using unified client
    const content = await generateAIResponse(aiConfig, {
      system: systemPrompts[outputType as keyof typeof systemPrompts],
      messages: [{ role: "user", content: context }],
      maxTokens: 4000,
    });

    const response: GenerateResponse = {
      content,
      outputType,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Generate API error:", error);
    return NextResponse.json(
      {
        error: "generation_error",
        message: "Failed to generate output. Please try again.",
      },
      { status: 500 }
    );
  }
}
