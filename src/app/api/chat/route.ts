import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateId, getCurrentTimestamp } from "@/lib/utils";
import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from "@/lib/rate-limit";
import type { ChatRequest, ChatResponse } from "@/types/api";
import type { Message } from "@/types/session";

// Check if we have a valid API key (not a placeholder)
const apiKey = process.env.ANTHROPIC_API_KEY;
const hasValidApiKey = apiKey && !apiKey.includes("your_") && apiKey.length > 20;

const anthropic = hasValidApiKey
  ? new Anthropic({ apiKey })
  : null;

// Track pseudo-puzzle patterns in conversation
function countPseudoPuzzlePatterns(messages: Message[]): { gapSpotting: number; blackBox: number; total: number } {
  let gapSpotting = 0;
  let blackBox = 0;

  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const content = msg.content.toLowerCase();

    if (content.includes("gap") || content.includes("overlooked") || content.includes("understudied") || content.includes("literature hasn't")) {
      gapSpotting++;
    }
    if (content.includes("black box") || content.includes("mechanism") || content.includes("underlying process")) {
      blackBox++;
    }
  }

  return { gapSpotting, blackBox, total: gapSpotting + blackBox };
}

// Development mode mock responses based on user input
function generateMockResponse(
  userMessage: string,
  currentPhase: string,
  messages: Message[] = [],
  settings: { beDirectMode: boolean; teachMeMode: boolean } = { beDirectMode: false, teachMeMode: false }
): string {
  const messageLower = userMessage.toLowerCase();
  const pseudoPuzzleCount = countPseudoPuzzlePatterns(messages);

  // ESCALATION LEVEL 3: After 3+ pseudo-puzzle attempts, acknowledge and suggest advisor
  if (pseudoPuzzleCount.total >= 3) {
    const isGapSpotting = messageLower.includes("gap") || messageLower.includes("overlooked") || messageLower.includes("understudied");

    if (isGapSpotting || pseudoPuzzleCount.gapSpotting >= 2) {
      return `I hear you, and I appreciate your persistence. Let me be direct about where we are.

You've consistently framed this as a gap-spotting approach—identifying something the literature hasn't addressed. That's a legitimate way to motivate research, and many published papers do exactly this. **I want to acknowledge that your perspective is valid.**

However, I've been pushing back because the gap-spotting framing has risks:
- Reviewers often respond with "maybe there's a reason this hasn't been studied"
- Without an anomaly to explain, the research may lack theoretical urgency
- The contribution can feel incremental rather than paradigm-shifting

**Here's what I'd document as concerns:**
1. The framing relies on identifying an unstudied topic rather than an unexplained pattern
2. The theoretical contribution may need strengthening
3. The research question would benefit from being grounded in a specific empirical anomaly

**My suggestion:** Given our back-and-forth, this might be a good moment to consult with a human advisor—your dissertation chair, a senior colleague, or a mentor in your area. They can provide field-specific judgment about whether this gap truly represents an important research opportunity, and they know the politics and positioning strategies in your specific scholarly community.

Would you like me to generate a research brief that documents both the gap you've identified and these methodological considerations? That could be useful for your conversation with an advisor.`;
    }

    if (messageLower.includes("black box") || messageLower.includes("mechanism") || pseudoPuzzleCount.blackBox >= 2) {
      return `I appreciate your commitment to this framing. Let me be honest about where we stand.

You're focused on opening the black box—understanding mechanisms and processes. That's valuable research, and organizational behavior has benefited enormously from mechanism-focused studies. **Your instinct to look inside processes is legitimate.**

However, my pushback has been about a specific concern:
- Mechanism research is strongest when there's reason to believe the mechanism differs from what theory predicts
- Without that tension, mechanism studies can become descriptive without advancing theory

**Here's what I'd document as concerns:**
1. The current framing emphasizes process description over theoretical anomaly
2. It may need a clearer statement of why the mechanism matters for predictions
3. Connecting to a puzzle about outcomes could strengthen the positioning

**My suggestion:** This feels like a good moment to consult with a human advisor. They can help you judge whether your field values mechanism research in its own right, or whether you'll need to connect it to outcome predictions. Different journals and subfields have different norms here.

Would you like me to generate a research brief summarizing your mechanism focus and these considerations? You could use it as a starting point for discussion with a mentor.`;
    }
  }

  // ESCALATION LEVEL 2: After 2 pseudo-puzzle attempts, be more direct
  if (pseudoPuzzleCount.total >= 2) {
    if (messageLower.includes("gap") || messageLower.includes("overlooked") || messageLower.includes("understudied")) {
      return `I notice we keep circling back to the gap-spotting framing. Let me be more direct this time.

**Gap-spotting ("the literature hasn't studied X") is risky because:**
- It invites the response: "Maybe X isn't important enough to study"
- It puts the burden on you to prove why X deserves attention
- It often leads to incremental rather than paradigm-shifting research

**What would make this stronger:**
- Show me something surprising—a pattern that *contradicts* what theory predicts
- Give me an empirical anomaly that *demands* explanation
- Frame it as "theory predicts A, but we observe B"

I'm not saying your topic isn't interesting. I'm saying the *framing* affects how reviewers and editors will receive it.

Can we try once more? Instead of what the literature *hasn't* done, what have you *observed* that seems wrong or unexpected given our current theories?`;
    }
  }

  // Check for common puzzle-related patterns
  if (messageLower.includes("conflict") && messageLower.includes("team")) {
    return `That's a fascinating observation about team conflict and performance. This touches on a real tension in organizational behavior research.

Let me probe a bit deeper:

1. **What specific type of conflict are you observing?** Researchers typically distinguish between task conflict (disagreements about work content), relationship conflict (interpersonal friction), and process conflict (disagreements about how to do things). The performance effects can differ substantially by type.

2. **In what context did you observe this pattern?** Was this in your own data, in a specific organization you studied, or something you noticed across multiple studies in the literature?

3. **What does existing theory predict?** Classical team effectiveness models (like those from Hackman or Kozlowski) generally predict that conflict should be detrimental. What made you expect teams with high conflict to perform worse?

Understanding these details will help us determine whether you've identified a genuine puzzle—an empirical pattern that contradicts theoretical predictions—or whether there might be moderating conditions that existing theory already accounts for.`;
  }

  if (messageLower.includes("gap") || messageLower.includes("overlooked") || messageLower.includes("understudied")) {
    // TEACH ME MODE: Provide explicit educational content about gap-spotting
    if (settings.teachMeMode) {
      return `**🎓 Teaching Moment: This is "Gap-Spotting"**

I've detected a pattern in your framing called **"gap-spotting"**—motivating research by identifying what the literature hasn't addressed. Let me explain why this approach has risks and what you can do instead.

**What is Gap-Spotting?**
Gap-spotting means justifying research because "the literature has overlooked X" or "there's a gap in our understanding of Y." It's one of the most common ways researchers frame their work—and also one of the most criticized.

**Why is it Risky?**
Organizational theorist Ezra Zuckerman (and others) have argued that gap-spotting is problematic because:
1. **It invites dismissal**: "Maybe there's a good reason this hasn't been studied"
2. **It lacks theoretical urgency**: Gaps exist everywhere; not all are worth filling
3. **It privileges novelty over contribution**: New ≠ important

**Real Paper Example:**
Consider the difference between:
- ❌ "No one has studied emotional intelligence in remote teams" (gap-spotting)
- ✅ "Theory predicts EI should matter more in remote teams due to reduced nonverbal cues, but surprisingly, we observe the opposite pattern" (genuine puzzle)

**Want to learn more?** I can explain:
- The 10 genres of research questions (Zuckerman's framework)
- How to transform a gap into a puzzle
- Examples from top journals showing good vs. weak framing

**Moving Forward:**
Instead of the gap you've identified, can you tell me: **What have you actually observed that surprised you?** What pattern exists that doesn't match what we'd theoretically expect?`;
    }

    // BE DIRECT MODE: Skip gentle probing and be candid about the issue
    if (settings.beDirectMode) {
      return `**Let me be direct with you:** This is gap-spotting, and it's a weak foundation for research.

**The Problem:**
Framing research as "the literature has overlooked X" or "there's a gap" is risky because:
- Reviewers will ask: "Maybe there's a good reason this hasn't been studied?"
- It puts the burden on you to prove importance, rather than letting an anomaly speak for itself
- Gaps are everywhere—that alone doesn't make a topic worth studying

**What You Need Instead:**
A genuine research puzzle has an empirical pattern that contradicts theoretical predictions. Not "X is unstudied" but "Theory predicts A, yet we observe B."

**My Direct Question:**
What have you actually observed—in data, fieldwork, or practice—that surprised you or seemed wrong given what theory would predict? If you can't point to a specific anomaly, this may not yet be ready to develop as a research puzzle.

Give me something concrete that contradicts existing theory, and we can work with that.`;
    }

    // Default gentle probing response (neither Teach Me nor Be Direct)
    return `I want to make sure we're building toward a genuine research puzzle here. When we say the literature has "overlooked" something or there's a "gap," that's often a starting point—but the strongest research puzzles go beyond identifying unstudied topics.

Let me ask: **What makes this gap puzzling?**

In other words, is there:
- An empirical pattern that we'd expect to see explained, but isn't?
- A theoretical prediction that doesn't match what we observe in practice?
- Something surprising happening in organizations that contradicts what our theories would predict?

The difference matters because "X hasn't been studied" invites the response "maybe X isn't important enough to study." But "X happens in ways that contradict theory Y" demands explanation.

Can you tell me more about what you've observed that made you notice this gap in the first place?`;
  }

  // Check for conflicting/contradictory theories - this is a genuine puzzle opportunity!
  if ((messageLower.includes("contradict") || messageLower.includes("conflict") || messageLower.includes("tension") || messageLower.includes("debate") || messageLower.includes("disagree")) &&
      (messageLower.includes("theor") || messageLower.includes("predict") || messageLower.includes("perspective") || messageLower.includes("framework"))) {
    return `**This is exactly the kind of situation that generates strong research puzzles!** When established theories make conflicting predictions, you have a genuine opportunity to contribute.

Let me highlight why this matters:

**The Research Value:**
- Theoretical conflict creates *demand* for new evidence—readers want to know which theory is right
- You're not just filling a gap; you're resolving a debate that matters to the field
- This framing naturally generates clear, testable hypotheses

**Different Theories at Play:**
Based on what you've described, it sounds like you're dealing with theories that predict different outcomes for the same phenomenon. This is exactly what reviewers look for—a puzzle that *theory itself* has created.

**Next Steps to Sharpen This:**
1. Can you identify the specific theories and their predictions? (e.g., "Theory A predicts X will increase performance, Theory B predicts X will decrease it")
2. What empirical context would allow us to see which prediction holds—or whether there are moderating conditions?
3. Is there existing evidence that seems to support one theory over another, and if so, what makes your context different?

This is promising! Let's develop the theoretical conflict further. Which theories are you seeing in tension, and what does each predict?`;
  }

  if (messageLower.includes("black box") || messageLower.includes("mechanism") || messageLower.includes("how") && messageLower.includes("why")) {
    return `"Opening the black box" can be valuable research, but let me push a bit on this framing.

The key question is: **Would understanding the mechanism change our theoretical predictions?**

Sometimes when we "open the black box" of a process, we discover that:
- The mechanism works exactly as we'd expect, just with more detail
- The added detail doesn't change what we predict or how we'd intervene

The strongest puzzle here would be if you have reason to believe that the mechanism works *differently* than current theory predicts—that understanding the "how" would reveal something surprising.

Can you tell me:
1. What does current theory predict about how this process works?
2. What have you observed (or do you suspect) that might contradict that prediction?
3. What would change in our understanding if the mechanism is different than assumed?`;
  }

  // Default response for other inputs
  if (currentPhase === "opening" || currentPhase === "probing") {
    return `Thank you for sharing that. I want to make sure I understand the foundation of your research interest.

A few clarifying questions:

1. **What's the specific empirical pattern you've observed?** Can you describe what you've actually seen—whether in data, in fieldwork, or in a particular case—that sparked this interest?

2. **What would theory predict?** Based on established frameworks in your area, what should we expect to happen?

3. **Where does the surprise come from?** What makes this pattern unexpected or hard to explain with existing theory?

These questions help us move toward articulating a genuine puzzle—not just an interesting topic, but a pattern that demands explanation because it contradicts our current theoretical understanding.

Take your time—the most important thing is being specific about what you've observed.`;
  }

  return `I appreciate you sharing that perspective. Let's work together to refine this into a compelling research puzzle.

The strongest puzzles in management research have these elements:
- A clear empirical pattern (what you've actually observed)
- A theoretical prediction that this pattern contradicts
- Implications for what evidence would resolve the puzzle

Based on what you've told me so far, could you elaborate on which of these elements you feel most confident about, and which might need more development?

I'm here to help you articulate this in a way that will be rigorous and compelling to reviewers.`;
}

// Log when using mock mode for transparency
if (!hasValidApiKey) {
  console.log("⚠️ Chat API running in MOCK MODE - Configure ANTHROPIC_API_KEY in .env.local for live responses");
}

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

    let responseContent: string;

    // Use mock response in development if no valid API key
    if (!anthropic) {
      // Get the last user message for generating a contextual mock response
      const lastUserMessage = messages.filter(m => m.role === "user").pop();
      responseContent = generateMockResponse(lastUserMessage?.content || "", currentPhase, messages, settings);
      console.log("📝 Using mock response (no valid API key configured)");
    } else {
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
      responseContent =
        response.content[0].type === "text" ? response.content[0].text : "";
    }

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
