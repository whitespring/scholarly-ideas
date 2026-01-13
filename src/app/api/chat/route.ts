import { NextRequest, NextResponse } from "next/server";
import { generateId, getCurrentTimestamp } from "@/lib/utils";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "@/lib/rate-limit";
import { extractAIConfig, validateAIConfig, generateAIResponse } from "@/lib/ai/client";
import type { ChatRequest, ChatResponse } from "@/types/api";
import type { Message } from "@/types/session";

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

## Offering Constructive Options

When asking complex or theoretical questions, provide 2-4 concrete examples or options the researcher can choose from or build on. This helps them engage more easily and learn about different approaches.

**Questions that should include options:**
- "What type of conflict?" → Offer: task conflict, relationship conflict, process conflict
- "What theoretical lens?" → Offer relevant theories from their subfield
- "What level of analysis?" → Offer: individual, team, organizational, field-level
- "What kind of evidence?" → Offer: quantitative data, qualitative fieldwork, mixed methods, archival

**When the researcher seems uncertain** (short responses, "I'm not sure", "maybe", hedging language), follow up by offering structured options to help them clarify their thinking.

**Format options clearly:**
- **Option A: [Name]** - Brief description of what this means
- **Option B: [Name]** - Brief description of what this means
- **Option C: [Name]** - Brief description of what this means

Always end with "Or is it something else entirely?" to leave room for their own framing.

## Working with Data Analysis
When the researcher has uploaded data, analysis results will be provided in the context below. Use these pre-computed results directly in your responses:
- Reference specific statistics, correlations, and patterns found in the analysis
- Discuss anomalies and what they might mean for the research puzzle
- Do NOT generate Python code or suggest the researcher run additional analyses
- Do NOT claim you cannot see or access their data - the analysis summaries contain the key findings
- Help interpret results in the context of their emerging research puzzle

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
    // Check rate limit
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(clientId, RATE_LIMITS.chat);

    if (!rateLimitResult.allowed) {
      const waitSeconds = Math.ceil(rateLimitResult.resetIn / 1000);
      return NextResponse.json(
        {
          error: "rate_limit",
          message: `You're sending messages too quickly. Please wait ${waitSeconds} seconds before trying again.`,
          retryAfter: waitSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": waitSeconds.toString(),
            "X-RateLimit-Limit": rateLimitResult.limit.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": Math.ceil(Date.now() / 1000 + rateLimitResult.resetIn / 1000).toString(),
          },
        }
      );
    }

    const body: ChatRequest = await request.json();
    const { messages, settings, currentPhase, subfield, analysisContext, literatureContext } = body;

    // Build context from analysis and literature if available
    let additionalContext = "";
    if (analysisContext && analysisContext.length > 0) {
      additionalContext += "\n\n## Data Analysis Results\n";
      additionalContext += "The following analyses have already been performed on the researcher's data. Reference these results when discussing their data - do not generate code or suggest they run analyses.\n\n";

      analysisContext.forEach((result) => {
        additionalContext += `### ${result.type.charAt(0).toUpperCase() + result.type.slice(1)} Analysis\n`;
        additionalContext += `${result.summary}\n`;

        // Include key details based on analysis type
        if (result.details) {
          if (result.type === 'descriptive' && result.details.statistics) {
            additionalContext += "\nKey statistics:\n";
            const stats = result.details.statistics as Record<string, Record<string, number>>;
            for (const [variable, varStats] of Object.entries(stats)) {
              if (varStats.mean !== undefined) {
                additionalContext += `- ${variable}: mean=${varStats.mean?.toFixed(2)}, std=${varStats.std?.toFixed(2)}, min=${varStats.min?.toFixed(2)}, max=${varStats.max?.toFixed(2)}\n`;
              }
            }
          }

          if (result.type === 'correlation' && result.details.strong_correlations) {
            const correlations = result.details.strong_correlations as Array<{var1: string; var2: string; correlation: number}>;
            if (correlations.length > 0) {
              additionalContext += "\nStrong correlations found:\n";
              correlations.forEach(c => {
                additionalContext += `- ${c.var1} ↔ ${c.var2}: r=${c.correlation.toFixed(3)}\n`;
              });
            }
          }

          if (result.type === 'anomaly' && result.details.anomalies) {
            const anomalies = result.details.anomalies as Array<{variable: string; outlier_count: number; outlier_percentage: number}>;
            if (anomalies.length > 0) {
              additionalContext += "\nOutliers detected:\n";
              anomalies.forEach(a => {
                additionalContext += `- ${a.variable}: ${a.outlier_count} outliers (${a.outlier_percentage.toFixed(1)}%)\n`;
              });
            }
          }

          if (result.type === 'theme' && result.details.themes) {
            const themes = result.details.themes as Array<{theme: string; frequency: number}>;
            if (themes.length > 0) {
              additionalContext += "\nThemes identified:\n";
              themes.slice(0, 5).forEach(t => {
                additionalContext += `- ${t.theme}: ${t.frequency} occurrences\n`;
              });
            }
          }
        }

        if (result.rigorWarnings.length > 0) {
          additionalContext += "\nRigor warnings:\n";
          result.rigorWarnings.forEach(w => {
            additionalContext += `- ⚠️ ${w.message}\n`;
          });
        }
        additionalContext += "\n";
      });
    }
    if (literatureContext && literatureContext.length > 0) {
      additionalContext += "\n\n## Literature Context\n";
      literatureContext.forEach((paper) => {
        additionalContext += `- ${paper.title} (${paper.year})${paper.isCrossDisciplinary ? ` [${paper.discipline}]` : ""}${paper.journalTier ? ` [${paper.journalTier}]` : ""}\n`;
      });
    }

    const systemPrompt = buildSystemPrompt(settings, currentPhase, subfield) + additionalContext;

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

    // Convert messages to AI SDK format
    const aiMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    // Call AI API using unified client
    const responseContent = await generateAIResponse(aiConfig, {
      system: systemPrompt,
      messages: aiMessages,
      maxTokens: 1024,
    });

    // Build response message
    const assistantMessage: Message = {
      id: generateId(),
      role: "assistant",
      content: responseContent,
      timestamp: getCurrentTimestamp(),
      metadata: {
        phase: currentPhase as NonNullable<Message["metadata"]>["phase"],
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
