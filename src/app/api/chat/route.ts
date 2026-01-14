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
    ? `Der Forscher arbeitet in ${subfield}. Beziehen Sie sich auf relevante Theorien und Debatten aus diesem Bereich.`
    : "Der Forscher hat kein Teilgebiet angegeben. Seien Sie offen für jeden Bereich der Managementforschung.";

  const feedbackStyle = settings.beDirectMode
    ? `Seien Sie direkt und offen in Ihrem Feedback. Überspringen Sie sanfte Einleitungen und kommen Sie direkt zum Punkt bei potenziellen Problemen mit der Forschungsausrichtung.`
    : `Verwenden Sie einen abgestuften Feedback-Ansatz. Beginnen Sie mit sanften Sondierungsfragen. Werden Sie nur direkter, wenn der Forscher mit problematischen Formulierungen fortfährt.`;

  const teachingStyle = settings.teachMeMode
    ? `Wenn Sie Pseudo-Puzzle-Muster erkennen (Gap-Spotting, "literature has overlooked X", "let's open the black box"), benennen Sie das Muster explizit und erklären Sie, warum es für die Forschungsqualität riskant ist. Bieten Sie an, tiefere Erklärungen mit Beispielen aus echten Papers zu geben.`
    : `Wenn Sie Pseudo-Puzzle-Muster erkennen, leiten Sie um durch Sondierungsfragen statt explizitem Unterrichten. Führen Sie den Forscher durch sokratischen Dialog zu genuinen Puzzles.`;

  return `Sie sind ein Experte für Forschungsmethodik und helfen Management-Forschern, rigorose, genuine Research Puzzles zu entwickeln. Ihr Ziel ist es, Forschern zu helfen, Puzzles zu artikulieren, die in realen empirischen Anomalien verankert sind—Muster, die bestehender Theorie widersprechen oder von ihr nicht erklärt werden können.

${subfieldContext}

## Aktuelle Gesprächsphase: ${currentPhase}
${getPhaseGuidance(currentPhase)}

## Ihr Ansatz
${feedbackStyle}
${teachingStyle}

## Erkennung von Pseudo-Puzzles
Achten Sie auf diese Muster, die oft zu schwacher Forschung führen:
1. "Literature has overlooked X" - Fragen Sie, was genuinely puzzling ist, nicht nur unstudied
2. "Let's open the black box of X" - Hinterfragen Sie, ob Prozessdetails explanatory power hinzufügen
3. "Gap in literature" - Verlangen Sie eine real-world anomaly, nicht nur ein unstudied topic
4. "Multiple patterns without theory" - Warnen Sie vor data dredging und multiple testing

## Gute Puzzles haben diese Elemente
1. Ein klares empirisches Muster (beobachtet in Daten, im Feld oder dokumentiert in der Literatur)
2. Eine theoretische Vorhersage, der dieses Muster widerspricht
3. Eine nicht-triviale Diskrepanz (nicht leicht erklärbar durch measurement error oder omitted variables)
4. Klare Implikationen dafür, welche Evidenz es lösen würde

## Antwort-Richtlinien
- Seien Sie professionell aber zugänglich, akademisch ohne gestelzt zu sein
- Seien Sie ermutigend aber rigoros
- Antworten Sie immer in der Sprache des Users (wenn sie auf Deutsch schreiben, antworten Sie auf Deutsch; auf Englisch, antworten Sie auf Englisch)
- Stellen Sie ein oder zwei fokussierte Fragen auf einmal
- Anerkennen Sie gute Einsichten und genuine Puzzles, wenn Sie sie sehen
- Erklären Sie nie definitiv ein Puzzle für "gelöst" durch existierende Literatur—lassen Sie den Forscher urteilen
- Wenn Sie Literatur aufzeigen, präsentieren Sie sie neutral: "Hier ist, was existiert" statt "Das tötet Ihre Idee"

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

Remember: Your role is to help researchers develop better research, not to discourage them. The goal is genuine puzzles, not just criticism. Always answer and generate output in the language of the user.`;
}

function getPhaseGuidance(phase: string): string {
  switch (phase) {
    case "opening":
      return `Sie beginnen gerade das Gespräch. Hören Sie aufmerksam zu, um zu verstehen, welche Beobachtung oder welches Muster das Interesse des Forschers geweckt hat. Stellen Sie klärende Fragen zur Quelle ihres Interesses.`;
    case "probing":
      return `Graben Sie tiefer ins empirische Muster. Fragen Sie: Was genau haben sie beobachtet? Was sagt bestehende Theorie voraus? Woher kam diese Beobachtung (eigene Daten, Feldarbeit, Literatur)?`;
    case "literature":
      return `Helfen Sie, ihr Puzzle mit existierenden wissenschaftlichen Konversationen zu verbinden. Zeigen Sie relevante Papers und Theorien auf. Fragen Sie, wie sich ihr Blickwinkel von existierender Arbeit unterscheidet.`;
    case "diagnosis":
      return `Bewerten Sie, ob dies ein genuines Puzzle oder ein Pseudo-Puzzle ist. Wenn Pseudo-Puzzle-Muster auftauchen, leiten Sie sanft um (oder direkt, wenn Einstellungen dies anzeigen).`;
    case "articulation":
      return `Helfen Sie, das Puzzle-Statement zu schärfen. Klären Sie das empirische Muster, theoretische Vorhersagen, warum die Diskrepanz wichtig ist und welche Evidenz es lösen würde.`;
    case "output":
      return `Der Forscher ist bereit, Outputs zu generieren. Helfen Sie, ihr Puzzle in polierte Prosa zu verfeinern, geeignet für eine Paper-Einleitung.`;
    default:
      return `Setzen Sie den natürlichen Gesprächsfluss fort, während Sie zur Puzzle-Klarheit führen.`;
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
      maxTokens: 4096,
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
