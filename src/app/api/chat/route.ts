import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateId, getCurrentTimestamp } from "@/lib/utils";
import type { ChatRequest, ChatResponse } from "@/types/api";
import type { Message } from "@/types/session";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// System prompt for the research puzzle assistant
function buildSystemPrompt(
  settings: { beDirectMode: boolean; teachMeMode: boolean },
  currentPhase: string,
  subfield?: string
): string {
  const subfieldContext = subfield
    ? `The researcher is working in ${subfield}. Reference relevant theories and debates from this area.`
    : "The researcher has not specified a subfield. Be open to any area of Management research.";

  const feedbackStyle = settings.beDirectMode
    ? `Be direct and candid in your feedback. Skip gentle preambles and get to the point about potential issues with the research framing.`
    : `Use a graduated feedback approach. Start with gentle probing questions. Only become more direct if the researcher persists with problematic framings.`;

  const teachingStyle = settings.teachMeMode
    ? `When you detect pseudo-puzzle patterns (gap-spotting, "literature has overlooked X", "let's open the black box"), explicitly name the pattern and explain why it's risky for research quality. Offer to provide deeper explanations with examples from real papers.`
    : `When you detect pseudo-puzzle patterns, redirect through probing questions rather than explicit teaching. Guide the researcher toward genuine puzzles through Socratic dialogue.`;

  return `You are a research methodology expert helping Management researchers develop rigorous, genuine research puzzles. Your goal is to help researchers articulate puzzles that are grounded in real empirical anomalies—patterns that contradict or cannot be explained by existing theory.

${subfieldContext}

## Current Conversation Phase: ${currentPhase}
${getPhaseGuidance(currentPhase)}

## Your Approach
${feedbackStyle}
${teachingStyle}

## Detecting Pseudo-Puzzles
Watch for these patterns that often lead to weak research:
1. "Literature has overlooked X" - Ask what's genuinely puzzling, not just unstudied
2. "Let's open the black box of X" - Challenge whether process detail adds explanatory power
3. "Gap in literature" - Demand a real-world anomaly, not just an unstudied topic
4. "Multiple patterns without theory" - Warn about data dredging and multiple testing

## Good Puzzles Have These Elements
1. A clear empirical pattern (observed in data, field, or documented in literature)
2. A theoretical prediction that this pattern contradicts
3. A non-trivial discrepancy (not easily explained by measurement error or omitted variables)
4. Clear implications for what evidence would resolve it

## Response Guidelines
- Be professional but approachable, academic without being stuffy
- Be encouraging but rigorous
- Ask one or two focused questions at a time
- Acknowledge good insights and genuine puzzles when you see them
- Never definitively declare a puzzle "solved" by existing literature—let the researcher judge
- When surfacing literature, present it neutrally: "Here's what exists" rather than "This kills your idea"

Remember: Your role is to help researchers develop better research, not to discourage them. The goal is genuine puzzles, not just criticism.`;
}

function getPhaseGuidance(phase: string): string {
  switch (phase) {
    case "opening":
      return `You're just starting the conversation. Listen carefully to understand what observation or pattern sparked the researcher's interest. Ask clarifying questions about the source of their interest.`;
    case "probing":
      return `Dig deeper into the empirical pattern. Ask about: What exactly did they observe? What does existing theory predict? Where did this observation come from (own data, fieldwork, literature)?`;
    case "literature":
      return `Help connect their puzzle to existing scholarly conversations. Surface relevant papers and theories. Ask how their angle differs from existing work.`;
    case "diagnosis":
      return `Assess whether this is a genuine puzzle or a pseudo-puzzle. If pseudo-puzzle patterns emerge, redirect gently (or directly if settings indicate).`;
    case "articulation":
      return `Help sharpen the puzzle statement. Clarify the empirical pattern, theoretical predictions, why the discrepancy matters, and what evidence would resolve it.`;
    case "output":
      return `The researcher is ready to generate outputs. Help refine their puzzle into polished prose suitable for a paper introduction.`;
    default:
      return `Continue the natural flow of conversation while guiding toward puzzle clarity.`;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { messages, settings, currentPhase, subfield, analysisContext, literatureContext } = body;

    // Build context from analysis and literature if available
    let additionalContext = "";
    if (analysisContext && analysisContext.length > 0) {
      additionalContext += "\n\n## Data Analysis Context\n";
      analysisContext.forEach((result) => {
        additionalContext += `- ${result.type}: ${result.summary}\n`;
        if (result.rigorWarnings.length > 0) {
          additionalContext += `  Warnings: ${result.rigorWarnings.map((w) => w.message).join("; ")}\n`;
        }
      });
    }
    if (literatureContext && literatureContext.length > 0) {
      additionalContext += "\n\n## Literature Context\n";
      literatureContext.slice(0, 5).forEach((paper) => {
        additionalContext += `- ${paper.title} (${paper.year})${paper.isCrossDisciplinary ? ` [${paper.discipline}]` : ""}\n`;
      });
    }

    const systemPrompt = buildSystemPrompt(settings, currentPhase, subfield) + additionalContext;

    // Convert messages to Anthropic format
    const anthropicMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Call Claude API
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: anthropicMessages,
    });

    // Extract response content
    const responseContent =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Build response message
    const assistantMessage: Message = {
      id: generateId(),
      role: "assistant",
      content: responseContent,
      timestamp: getCurrentTimestamp(),
      metadata: {
        phase: currentPhase as Message["metadata"]["phase"],
      },
    };

    const chatResponse: ChatResponse = {
      message: assistantMessage,
    };

    return NextResponse.json(chatResponse);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        error: "chat_error",
        message: "Failed to process chat message. Please try again.",
      },
      { status: 500 }
    );
  }
}
