import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Message, LiteratureResult, AnalysisResult } from "@/types/session";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

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

// Extract key topics from user messages for context-aware fallback
function extractKeyTopics(text: string): string[] {
  const topics: string[] = [];

  // Common research-relevant phrases to look for
  const patterns = [
    /(?:studying|researching|investigating|examining|exploring)\s+([^.!?]+)/gi,
    /(?:puzzle|puzzling|surprising|unexpected|contradicts?)\s+(?:about|regarding|that)?\s*([^.!?]+)/gi,
    /(?:startups?|companies|firms|organizations?|teams?)\s+([^.!?]+)/gi,
    /(?:theory|theories)\s+(?:of|about|regarding)?\s*([^.!?]+)/gi,
    /(?:why|how)\s+([^.!?]+)/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 10 && match[1].length < 100) {
        topics.push(match[1].trim().toLowerCase());
      }
    }
  }

  // Also extract noun phrases that appear frequently
  const words = text.toLowerCase().split(/\s+/);
  const importantTerms = [
    "startup", "startups", "funding", "venture", "capital", "scaling",
    "performance", "failure", "success", "growth", "learning",
    "resource", "theory", "organizational", "management", "innovation",
    "team", "conflict", "leadership", "strategy", "entrepreneurship"
  ];

  const foundTerms = importantTerms.filter(term => words.includes(term));
  if (foundTerms.length > 0) {
    topics.unshift(foundTerms.slice(0, 3).join(" and "));
  }

  // Deduplicate and return
  const uniqueTopics = [...new Set(topics)];
  return uniqueTopics.length > 0 ? uniqueTopics : ["the research phenomenon"];
}

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

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_anthropic_api_key_here") {
      // Development fallback: generate context-aware output from conversation
      const context = buildContext(messages, literatureFindings, analysisResults, subfield);

      // Extract key themes from the conversation for the fallback
      const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join(" ");

      // Generate context-aware fallback output
      const generateContextAwareFallback = (type: string): string => {
        // Extract potential key topics from user messages
        const topics = extractKeyTopics(userMessages);
        const mainTopic = topics[0] || "research phenomenon";
        const secondaryTopics = topics.slice(1, 3).join(", ") || "related factors";

        if (type === "statement") {
          return `Recent observations reveal a puzzling pattern regarding ${mainTopic}. Based on the conversation, the researcher has identified an empirical anomaly: ${userMessages.slice(0, 300)}${userMessages.length > 300 ? "..." : ""}

This finding appears to contradict established theoretical predictions. The discrepancy between what theory predicts and what has been observed presents a genuine research puzzle worthy of systematic investigation. Understanding this pattern could advance our theoretical knowledge and provide practical insights for practitioners in the field.`;
        } else if (type === "introduction") {
          return `# Introduction

## The Puzzle

${mainTopic.charAt(0).toUpperCase() + mainTopic.slice(1)} presents a compelling theoretical puzzle. Based on the researcher's observations: ${userMessages.slice(0, 500)}${userMessages.length > 500 ? "..." : ""}

## Theoretical Background

Existing theories in this domain would predict different outcomes than what has been observed. This discrepancy suggests our current theoretical frameworks may be incomplete or may require boundary conditions we have not yet identified.

## Why This Matters

Resolving this puzzle would contribute to our understanding of ${mainTopic} and its relationship to ${secondaryTopics}. The implications extend to both theory development and practical application.

## Our Approach

This paper develops and tests a framework to understand when and why ${mainTopic} leads to the observed outcomes. By identifying the mechanisms and boundary conditions at play, we aim to resolve the apparent contradiction between theory and evidence.`;
        } else {
          return `# Research Brief

## 1. The Puzzle

${userMessages.slice(0, 600)}${userMessages.length > 600 ? "..." : ""}

## 2. Why It Matters

**Theoretical Significance:** This puzzle challenges existing frameworks and could lead to theoretical refinement or extension. Understanding ${mainTopic} more deeply would advance our field.

**Practical Significance:** Practitioners would benefit from clearer guidance on ${mainTopic} and its implications.

## 3. Key Related Papers

Based on the themes discussed, relevant literature likely includes work on:
- ${mainTopic} and its antecedents
- ${secondaryTopics} in organizational contexts
- Theoretical frameworks predicting outcomes in this domain

## 4. Evidence Needed

To address this puzzle convincingly, research would need:
- Systematic data on ${mainTopic}
- Measures of potential moderating and mediating variables
- Longitudinal or experimental designs to establish causality

## 5. Suggested Approach

A multi-method approach combining quantitative analysis with qualitative insights would be well-suited to this puzzle. The researcher should consider both the boundary conditions under which the observed pattern holds and the mechanisms that might explain it.`;
        }
      };

      const response: GenerateResponse = {
        content: generateContextAwareFallback(outputType),
        outputType,
      };

      return NextResponse.json(response);
    }

    // Build context from conversation and findings
    const context = buildContext(messages, literatureFindings, analysisResults, subfield);

    // Call Claude API
    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: systemPrompts[outputType as keyof typeof systemPrompts],
      messages: [
        {
          role: "user",
          content: context,
        },
      ],
    });

    // Extract response content
    const responseContent = completion.content[0];
    if (responseContent.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    const response: GenerateResponse = {
      content: responseContent.text,
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
