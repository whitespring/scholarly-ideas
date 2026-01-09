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
      // Development fallback: return sample output
      const sampleOutputs: Record<string, string> = {
        statement: `Recent observations suggest a puzzling pattern in organizational team dynamics: teams experiencing moderate levels of task-related conflict often outperform their more harmonious counterparts. This finding stands in apparent contradiction to classical team effectiveness models, which generally predict that conflict—regardless of type—should impair group performance through increased coordination costs, reduced cohesion, and diverted attention from task completion.

This discrepancy presents a genuine theoretical puzzle. If conflict is uniformly detrimental as traditional models suggest, we should observe a monotonically negative relationship between conflict and performance. Yet emerging evidence points to a more nuanced reality: under certain conditions, disagreement may serve as a catalyst for deeper information processing, creative problem-solving, and the surfacing of diverse perspectives that might otherwise remain hidden. Understanding when and why conflict enhances rather than undermines team performance could significantly advance our theoretical understanding of group dynamics and provide actionable guidance for managers navigating the inherent tensions of collaborative work.`,

        introduction: `# Introduction

The relationship between conflict and performance in organizational teams has long puzzled scholars and practitioners alike. Conventional wisdom, supported by decades of research, suggests that conflict is detrimental to team functioning—it diverts attention from task work, damages interpersonal relationships, and impairs the coordination essential for collective achievement (De Dreu & Weingart, 2003; Jehn, 1995). Yet a growing body of evidence challenges this straightforward narrative, revealing conditions under which conflict may actually enhance team outcomes.

## The Theoretical Puzzle

Classical team effectiveness models, from Hackman's (1987) input-process-output framework to more recent multilevel theories of team performance (Kozlowski & Ilgen, 2006), generally treat conflict as a process loss—a friction that reduces the team's ability to convert its inputs into outputs. The logic is intuitive: when team members disagree, they must expend resources resolving those disagreements rather than pursuing their collective goals.

However, this view struggles to account for a compelling counter-pattern: teams with moderate levels of task conflict often demonstrate superior creative problem-solving, more thorough information processing, and ultimately better performance than teams with very low conflict (Jehn & Mannix, 2001). This finding suggests that some degree of disagreement may be not merely tolerable but actively beneficial.

## Why This Matters

Resolving this puzzle carries significant implications for both theory and practice. Theoretically, it challenges us to move beyond simple linear models of conflict's effects and develop more nuanced frameworks that can account for the apparent curvilinear or contingent relationships we observe. Practically, it offers the prospect of guidance for managers who must navigate the delicate balance between fostering the creative friction that drives innovation and preventing the destructive conflict that tears teams apart.

## Our Approach

In this paper, we develop and test a contingency model of conflict and performance that identifies the boundary conditions under which task conflict enhances versus undermines team outcomes. Drawing on information processing theory and research on team psychological safety, we propose that the effects of conflict depend critically on how teams process and integrate the diverse perspectives that disagreement surfaces.`,

        brief: `# Research Brief: The Conflict-Performance Paradox in Teams

## 1. The Puzzle

Observations from both field studies and laboratory research reveal a counterintuitive pattern: teams with moderate levels of task conflict often outperform teams with very low or very high conflict. This finding contradicts the predictions of classical team effectiveness models, which generally suggest that conflict should have uniformly negative effects on team performance.

The puzzle is sharpened by the distinction between task conflict (disagreements about work content and approaches) and relationship conflict (interpersonal friction and animosity). While relationship conflict appears consistently detrimental, task conflict shows a more complex pattern—sometimes positive, sometimes negative, depending on conditions we do not yet fully understand.

This represents a genuine theoretical anomaly: our dominant frameworks cannot adequately explain when and why task conflict enhances performance, nor can they reliably predict the conditions under which conflict transitions from helpful to harmful.

## 2. Why It Matters

**Theoretical Significance:** Resolving this puzzle would advance our understanding of group dynamics by moving beyond simple linear models to more nuanced contingency frameworks. It would help integrate disparate findings in the conflict literature and potentially reveal new mechanisms through which diverse perspectives contribute to collective intelligence.

**Practical Significance:** Managers face daily decisions about how to handle disagreement in their teams. Without clear guidance on when conflict is productive versus destructive, they may either suppress valuable debate or allow harmful friction to fester. A clearer theoretical account would enable more effective conflict management strategies.

## 3. Key Related Papers

1. **Jehn, K. A. (1995). "A multimethod examination of the benefits and detriments of intragroup conflict."** Foundational paper establishing the task/relationship conflict distinction.

2. **De Dreu, C. K. W., & Weingart, L. R. (2003). "Task versus relationship conflict, team performance, and team member satisfaction: A meta-analysis."** Comprehensive meta-analysis finding negative effects of both conflict types, though with substantial heterogeneity.

3. **Jehn, K. A., & Mannix, E. A. (2001). "The dynamic nature of conflict: A longitudinal study."** Demonstrates that conflict patterns evolve over time and have different effects at different stages of team development.

4. **De Dreu, C. K. W. (2006). "When too little or too much hurts: Evidence for a curvilinear relationship."** Provides evidence for inverted U-shaped relationship between task conflict and outcomes.

## 4. Evidence Needed

To convincingly address this puzzle, research would need to:

- **Longitudinal data** tracking teams over time to capture how conflict patterns evolve and their dynamic effects on performance
- **Multiple measures of conflict** distinguishing task, relationship, and process conflict at fine-grained intervals
- **Objective performance metrics** that go beyond self-report and capture multiple dimensions of team effectiveness
- **Moderator measures** including psychological safety, team diversity, task complexity, and conflict management norms
- **Process data** illuminating how teams handle disagreement—do they integrate diverse views or simply suppress them?

## 5. Suggested Approach

**Research Design:** A longitudinal field study following project teams from formation through completion, with weekly surveys capturing conflict levels and types, team process observations, and objective performance metrics at project milestones.

**Sample:** Knowledge-intensive teams (e.g., product development, consulting, research teams) where task conflict is likely to be prevalent and consequential. Target 50-100 teams to enable multilevel modeling.

**Key Analyses:** Growth curve models examining how conflict trajectories relate to performance outcomes, moderated by team and contextual factors. Process tracing to identify mechanisms through which task conflict influences information processing and decision quality.`,
      };

      const response: GenerateResponse = {
        content: sampleOutputs[outputType] || sampleOutputs.statement,
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
