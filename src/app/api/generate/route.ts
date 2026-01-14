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
  statement: `Sie sind ein Experte für akademisches Schreiben und helfen Forschern, ihre Research Puzzles zu artikulieren.

Basierend auf dem Gespräch, generieren Sie ein poliertes 1-2 Absatz PUZZLE STATEMENT, das als Eröffnung einer Research Paper Introduction dienen könnte.

Das Statement sollte:
1. Das empirische Muster oder die Beobachtung, die puzzling ist, klar beschreiben
2. Erklären, was bestehende Theorie vorhersagen würde und warum diese Beobachtung überraschend ist
3. Artikulieren, warum diese Diskrepanz für Theorie und/oder Praxis wichtig ist
4. In polierter akademischer Prosa geschrieben sein, geeignet für ein Top-Management-Journal

Fügen Sie KEINE Einleitung oder Erklärung hinzu - stellen Sie nur das Puzzle Statement direkt bereit.`,

  introduction: `Sie sind ein Experte für akademisches Schreiben und helfen Forschern, Paper-Einleitungen zu verfassen.

Basierend auf dem Gespräch, generieren Sie einen 2-3 Seiten INTRODUCTION DRAFT für ein akademisches Paper.

Die Einleitung sollte dieser Struktur folgen:
1. Einleitender Hook, der das Puzzle etabliert (1-2 Absätze)
2. Kurze Übersicht relevanter Literatur und theoretischer Vorhersagen (2-3 Absätze)
3. Klares Statement, wie das empirische Muster diesen Vorhersagen widerspricht (1 Absatz)
4. Warum dieses Puzzle wichtig ist - theoretische und praktische Implikationen (1-2 Absätze)
5. Kurze Vorschau auf den Ansatz und die Beiträge des Papers (1 Absatz)

Schreiben Sie in polierter akademischer Prosa, geeignet für ein Top-Management-Journal. Verwenden Sie einen generischen Stil, der für jedes Journal angepasst werden kann.

Fügen Sie KEINE Einleitung oder Erklärung hinzu - stellen Sie nur den Introduction Draft direkt bereit.`,

  brief: `Sie sind ein Experte für akademisches Schreiben und helfen Forschern, umfassende Research Briefs zu erstellen.

Basierend auf dem Gespräch, generieren Sie ein RESEARCH BRIEF mit den folgenden 5 Sektionen:

## 1. Das Puzzle
Ein klares, prägnantes Statement des empirischen Musters, das bestehender Theorie widerspricht oder von ihr nicht erklärt werden kann. (2-3 Absätze)

## 2. Warum es wichtig ist
Theoretische und praktische Bedeutung der Lösung dieses Puzzles. Was würden wir lernen? Was würde sich ändern? (2-3 Absätze)

## 3. Wichtige verwandte Papers
Zusammenfassung der relevantesten existierenden Literatur und wie dieses Puzzle sich auf laufende wissenschaftliche Konversationen bezieht. (Listen Sie 3-5 Papers mit kurzen Annotationen auf)

## 4. Benötigte Evidenz
Welche Daten oder Evidenz wären nötig, um dieses Puzzle überzeugend zu adressieren? Was würde einen starken Test ausmachen? (2-3 Absätze)

## 5. Vorgeschlagener Ansatz
Vorläufige Gedanken zu Methodologie, Datenquellen und Research Design, die dieses Puzzle adressieren könnten. (2-3 Absätze)

Schreiben Sie in polierter akademischer Prosa. Jede Sektion sollte substanziell und umsetzbar sein.

Fügen Sie KEINE Einleitung oder Erklärung hinzu - stellen Sie nur das Research Brief direkt bereit.`,
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
      maxTokens: 16000,
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
