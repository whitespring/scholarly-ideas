"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { useAISettings } from "@/context/AISettingsContext";
import { cn, formatTimestamp, fetchWithTimeout, retryWithBackoff } from "@/lib/utils";
import type { Message, AnalysisResult, LiteratureResult } from "@/types";
import {
  Send,
  Upload,
  BookOpen,
  FileOutput,
  Settings,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  FileText,
  Download,
  FileUp,
  FileDown,
  Cpu,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import jsPDF from "jspdf";
import { AIProviderSettings } from "@/components/settings/AIProviderSettings";
import { PROVIDER_CONFIGS } from "@/lib/ai/config";

// Opening prompts based on mode
const openingPrompts: Record<string, string> = {
  idea: "Tell me about the observation or pattern that sparked your interest. What have you noticed—in your data, in the field, or in your reading—that you find surprising or hard to explain?",
  data: "What is this data, and why did you collect it? Understanding the context will help us explore what it might tell us.",
  exploring:
    "What's been on your mind lately? What surprised you in your reading or observations? I'd love to hear what's captured your curiosity.",
};

export default function ConversationPage() {
  const router = useRouter();
  const { session, addMessage, updateSettings, addFile, removeFile, addAnalysis, addLiterature, addArtifact, importSession } = useSession();
  const { settings: aiSettings, getRequestHeaders, isConfigured: isAIConfigured } = useAISettings();
  const [input, setInput] = useState("");
  const [showAISettings, setShowAISettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(false); // Default closed on mobile
  const [isMobile, setIsMobile] = useState(false);

  // Check if mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      // Auto-open panel on desktop, keep closed on mobile
      if (window.innerWidth >= 768) {
        setIsContextPanelOpen(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  const [showSettings, setShowSettings] = useState(false);
  const [isSearchingLiterature, setIsSearchingLiterature] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOutputModal, setShowOutputModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedOutput, setGeneratedOutput] = useState<{ content: string; type: string } | null>(null);
  const [selectedOutputType, setSelectedOutputType] = useState<"statement" | "introduction" | "brief">("statement");
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [selectedFileDetails, setSelectedFileDetails] = useState<{ id: string; name: string; type: string; size: number; uploadedAt: string; summary?: string } | null>(null);
  const [selectedPaperDetails, setSelectedPaperDetails] = useState<LiteratureResult | null>(null);
  const [selectedArtifactDetails, setSelectedArtifactDetails] = useState<{ id: string; type: string; content: string; version: number; createdAt: string } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAddedOpeningMessage = useRef(false);

  // Check if there are unsaved changes (more than just the initial assistant message)
  const hasUnsavedChanges = useCallback(() => {
    // User has sent at least one message
    const hasUserMessages = session.messages.some(m => m.role === 'user');
    // Has uploaded files
    const hasFiles = session.uploadedFiles.length > 0;
    // Has analysis results beyond what's auto-generated
    const hasAnalysis = session.analysisResults.length > 0;
    // Has literature findings
    const hasLiterature = session.literatureFindings.length > 0;
    // Has generated outputs
    const hasOutputs = session.puzzleArtifacts.length > 0;

    return hasUserMessages || hasFiles || hasAnalysis || hasLiterature || hasOutputs;
  }, [session.messages, session.uploadedFiles, session.analysisResults, session.literatureFindings, session.puzzleArtifacts]);

  // Warn user before closing tab/window if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Handle navigation to home with warning
  const handleNavigateHome = useCallback(() => {
    if (hasUnsavedChanges()) {
      setShowUnsavedWarning(true);
    } else {
      router.push('/');
    }
  }, [hasUnsavedChanges, router]);

  // Auto-dismiss success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  // Add opening prompt if no messages (only once)
  useEffect(() => {
    if (session.messages.length === 0 && session.mode && !hasAddedOpeningMessage.current) {
      hasAddedOpeningMessage.current = true;
      addMessage({
        role: "assistant",
        content: openingPrompts[session.mode] || openingPrompts.idea,
        metadata: { phase: "opening" },
      });
    }
  }, [session.mode, session.messages.length, addMessage]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);

    // Add user message
    addMessage({
      role: "user",
      content: userMessage,
    });

    try {
      // Use retry with exponential backoff for LLM calls
      const data = await retryWithBackoff(
        async () => {
          const response = await fetchWithTimeout("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getRequestHeaders() },
            body: JSON.stringify({
              messages: [...session.messages, { role: "user", content: userMessage }],
              settings: session.settings,
              currentPhase: session.currentPhase,
              subfield: session.subfield,
              analysisContext: session.analysisResults,
              literatureContext: session.literatureFindings,
            }),
            timeout: 60000, // 60 second timeout for LLM calls
          });

          // Handle rate limit error specifically
          if (response.status === 429) {
            const errorData = await response.json();
            const rateLimitError = new Error(errorData.message || "Rate limit exceeded");
            (rateLimitError as Error & { isRateLimit: boolean; retryAfter?: number }).isRateLimit = true;
            (rateLimitError as Error & { retryAfter?: number }).retryAfter = errorData.retryAfter;
            throw rateLimitError;
          }

          if (!response.ok) {
            throw new Error("Failed to get response");
          }

          return response.json();
        },
        {
          maxRetries: 2,
          initialDelay: 1000,
          maxDelay: 5000,
          shouldRetry: (error) => {
            // Don't retry rate limit errors
            if ((error as Error & { isRateLimit?: boolean }).isRateLimit) {
              return false;
            }
            // Retry on timeout (AbortError) or server errors
            if (error instanceof Error) {
              return error.name === 'AbortError' || error.message.includes('timeout');
            }
            return false;
          },
        }
      );

      addMessage(data.message);
    } catch (error) {
      console.error("Chat error:", error);
      // Determine error type for appropriate user message
      const isRateLimitError = (error as Error & { isRateLimit?: boolean }).isRateLimit;
      const retryAfter = (error as Error & { retryAfter?: number }).retryAfter;
      const isTimeoutError = error instanceof Error && (error.name === 'AbortError' || error.message.includes('timeout'));
      const isNetworkError = error instanceof TypeError && error.message.includes('fetch');

      let errorMessage: string;
      if (isRateLimitError) {
        errorMessage = `You're sending messages too quickly. Please wait ${retryAfter || 60} seconds before trying again. Your conversation is saved and you can continue shortly.`;
      } else if (isTimeoutError) {
        errorMessage = "The request took too long and timed out. The server might be busy. Please try again in a moment. Your conversation context is preserved.";
      } else if (isNetworkError) {
        errorMessage = "Unable to connect to the server. Please check your internet connection and try again.";
      } else {
        errorMessage = "I apologize, but I encountered an error processing your message. Please try again.";
      }

      addMessage({
        role: "assistant",
        content: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    // Read file content as base64 for later analysis
    const readFileAsBase64 = (): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    };

    try {
      // Read file content first
      const fileBase64 = await readFileAsBase64();
      const fileName = file.name;
      const fileType = file.type;
      const extension = fileName.split(".").pop()?.toLowerCase();

      // Handle text files for qualitative analysis
      if (extension === "txt") {
        await handleTextFileUpload(file, fileBase64, fileName, fileType);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to upload file");
      }

      // Add file to session
      addFile({
        name: file.name,
        type: file.type || data.summary.file_type,
        size: file.size,
        summary: `${data.summary.rows} rows, ${data.summary.columns} columns`,
      });

      // Add analysis result with variable statistics
      const variableStats = data.summary.variables || [];
      const numericVars = variableStats.filter((v: { mean?: number }) => v.mean !== undefined && v.mean !== null);
      const categoricalVars = variableStats.filter((v: { unique?: number }) => v.unique !== undefined);

      addAnalysis({
        type: "descriptive",
        summary: `Loaded ${file.name}: ${data.summary.rows} rows, ${data.summary.columns} columns. ${numericVars.length} numeric and ${categoricalVars.length} categorical variables.`,
        details: {
          variables: variableStats,
          rows: data.summary.rows,
          columns: data.summary.columns,
        },
        rigorWarnings: data.summary.rows < 30 ? [
          {
            type: "sample_size" as const,
            message: `Small sample size (n=${data.summary.rows}). Results may not be generalizable.`,
            severity: "high" as const,
          }
        ] : [],
      });

      // Add a message to the conversation about the upload
      addMessage({
        role: "assistant",
        content: `Ich habe Ihre Datendatei "${file.name}" erhalten. Hier ist eine kurze Zusammenfassung:\n\n**Datei-Details:**\n- ${data.summary.rows} Beobachtungen (Zeilen)\n- ${data.summary.columns} Variablen (Spalten)\n- Format: ${data.summary.file_type.toUpperCase()}\n\n${numericVars.length > 0 ? `**Numerische Variablen:** ${numericVars.map((v: { name: string }) => v.name).join(", ")}\n\n` : ""}${categoricalVars.length > 0 ? `**Kategorische Variablen:** ${categoricalVars.map((v: { name: string }) => v.name).join(", ")}\n\n` : ""}Was fällt Ihnen an diesen Daten auf? Welche Muster oder Überraschungen haben Sie beim Sammeln bemerkt?`,
        metadata: { phase: "probing", analysisTriggered: true },
      });

      // Run anomaly detection automatically if we have numeric data
      if (numericVars.length > 0) {
        try {
          const anomalyResponse = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              analysisType: "anomaly",
              fileContent: fileBase64,
              fileName: fileName,
              fileType: fileType,
            }),
          });

          if (anomalyResponse.ok) {
            const anomalyData = await anomalyResponse.json();
            if (anomalyData.result) {
              addAnalysis({
                type: "anomaly",
                summary: anomalyData.result.summary,
                details: anomalyData.result.details,
                rigorWarnings: (anomalyData.result.rigor_warnings || []).map((w: { type: string; message: string; severity: string }) => ({
                  type: w.type as "multiple_testing" | "data_dredging" | "sample_size" | "selection_bias",
                  message: w.message,
                  severity: w.severity as "low" | "medium" | "high",
                })),
              });
            }
          }
        } catch (anomalyError) {
          console.error("Anomaly analysis error:", anomalyError);
          // Non-critical, don't show error to user
        }
      }
    } catch (error) {
      console.error("Upload error:", error);
      const isNetworkError = error instanceof TypeError && error.message.includes('fetch');
      setUploadError(
        isNetworkError
          ? "Unable to connect to the server. Please check your internet connection and try again."
          : (error instanceof Error ? error.message : "Failed to upload file")
      );
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleTextFileUpload = async (file: File, fileBase64: string, fileName: string, fileType: string) => {
    try {
      // Add file to session
      addFile({
        name: file.name,
        type: file.type || "text/plain",
        size: file.size,
        summary: "Qualitative text data",
      });

      // Run theme analysis
      const themeResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisType: "theme",
          fileContent: fileBase64,
          fileName: fileName,
          fileType: fileType || "text/plain",
        }),
      });

      let themesList = "";
      if (themeResponse.ok) {
        const themeData = await themeResponse.json();
        if (themeData.result) {
          addAnalysis({
            type: "theme",
            summary: themeData.result.summary,
            details: themeData.result.details,
            rigorWarnings: (themeData.result.rigor_warnings || []).map((w: { type: string; message: string; severity: string }) => ({
              type: w.type as "multiple_testing" | "data_dredging" | "sample_size" | "selection_bias" | "methodology",
              message: w.message,
              severity: w.severity as "low" | "medium" | "high",
            })),
          });

          // Format themes for the message
          const themes = themeData.result.details?.themes || [];
          const topThemes = themes.slice(0, 5);
          themesList = topThemes.map((t: { theme: string; frequency: number }) =>
            `- **${t.theme}** (mentioned ${t.frequency} times)`
          ).join("\n");
        }
      }

      // Run quote analysis to find surprising quotes
      const quoteResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisType: "quote",
          fileContent: fileBase64,
          fileName: fileName,
          fileType: fileType || "text/plain",
        }),
      });

      let quotesList = "";
      if (quoteResponse.ok) {
        const quoteData = await quoteResponse.json();
        if (quoteData.result) {
          addAnalysis({
            type: "quotes",
            summary: quoteData.result.summary,
            details: quoteData.result.details,
            rigorWarnings: (quoteData.result.rigor_warnings || []).map((w: { type: string; message: string; severity: string }) => ({
              type: w.type as "multiple_testing" | "data_dredging" | "sample_size" | "selection_bias" | "methodology",
              message: w.message,
              severity: w.severity as "low" | "medium" | "high",
            })),
          });

          // Format quotes for the message
          const quotes = quoteData.result.details?.quotes || [];
          if (quotes.length > 0) {
            quotesList = quotes.slice(0, 3).map((q: { text: string; source: string; type: string }) =>
              `> "${q.text}" *(${q.source})*`
            ).join("\n\n");
          }
        }
      }

      // Build the combined message
      let messageContent = `I've analyzed your qualitative data file "${file.name}".\n\n`;

      if (themesList) {
        messageContent += `**Theme Analysis:**\n${themesList}\n\n`;
      }

      if (quotesList) {
        messageContent += `**Potentially Surprising Quotes:**\n${quotesList}\n\n`;
      }

      messageContent += "What patterns stood out to you when collecting this data? Do any of these quotes challenge your initial assumptions?";

      addMessage({
        role: "assistant",
        content: messageContent,
        metadata: { phase: "probing", analysisTriggered: true },
      });
    } catch (error) {
      console.error("Text file analysis error:", error);
      setUploadError(error instanceof Error ? error.message : "Failed to analyze text file");
    }
  };

  const handleSearchLiterature = () => {
    // Extract a suggested query from recent conversation messages
    const recentUserMessages = session.messages
      .filter(m => m.role === "user")
      .slice(-3)
      .map(m => m.content)
      .join(" ");

    // Extract key topics from the conversation
    const suggestedQuery = recentUserMessages
      .split(/[.!?,;]+/)
      .filter(s => s.trim().length > 10)
      .slice(0, 2)
      .join(" ")
      .slice(0, 100)
      .trim() || "organizational behavior research";

    setSearchQuery(suggestedQuery);
    setShowSearchModal(true);
  };

  const executeSearchLiterature = async (query: string) => {
    if (!query.trim()) return;

    setIsSearchingLiterature(true);
    setShowSearchModal(false);

    try {
      const response = await fetch("/api/literature", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getRequestHeaders() },
        body: JSON.stringify({
          query: query.trim(),
          subfield: session.subfield,
          limit: 5,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited - show user-friendly message with retry suggestion
          addMessage({
            role: "assistant",
            content: "The literature search API is rate limited (max 1 request per second). Please wait a few seconds and try your search again. This helps ensure fair access for all users.",
          });
          return;
        }
        throw new Error(data.message || "Failed to search literature");
      }

      if (data.papers && data.papers.length > 0) {
        addLiterature(data.papers);

        // Format papers for the message - show classics and recent separately if available
        const formatPaper = (p: { title: string; authors: string[]; year: number; isCrossDisciplinary?: boolean; discipline?: string; journalTier?: string; citationCount?: number }) =>
          `- **${p.title}** (${p.authors.slice(0, 2).join(", ")}${p.authors.length > 2 ? " et al." : ""}, ${p.year})${p.journalTier ? ` [${p.journalTier}]` : ""}${p.citationCount ? ` (${p.citationCount.toLocaleString()} citations)` : ""}${p.isCrossDisciplinary ? ` [${p.discipline}]` : ""}`;

        let papersList: string;
        if (data.classics?.length > 0 || data.recent?.length > 0) {
          // Show classics and recent separately
          const classicsList = data.classics?.length > 0
            ? `**Classic/Foundational Works (500+ citations):**\n${data.classics.map(formatPaper).join("\n")}`
            : "";
          const recentList = data.recent?.length > 0
            ? `**Recent Research (last 5 years):**\n${data.recent.map(formatPaper).join("\n")}`
            : "";
          papersList = [classicsList, recentList].filter(Boolean).join("\n\n");
        } else {
          // Fallback to showing all papers
          papersList = data.papers.map(formatPaper).join("\n");
        }

        // Build the message content - include search context if not an exact match
        let content = "";
        if (data.searchMetadata?.message && !data.searchMetadata.exactMatchFound) {
          content += `**Note:** ${data.searchMetadata.message}\n\n`;
        }
        content += `I found ${data.papers.length} relevant papers for "${query}":\n\n${papersList}`;

        // Add Claude's analysis of research puzzles if available
        if (data.analysis) {
          content += `\n\n---\n\n**What I see in this literature:**\n\n${data.analysis}`;
        } else {
          // Fallback to the generic questions if no analysis
          content += "\n\nThese papers seem to address similar themes. **How is your angle different?** What specific contribution would your research make beyond what's already been studied?";
        }

        addMessage({
          role: "assistant",
          content,
          metadata: { phase: "literature", literatureQueried: true },
        });
      } else {
        // No papers found - use the metadata message if available
        const noResultsMessage = data.searchMetadata?.message ||
          `I couldn't find papers matching "${query}". Try adjusting your search terms or being more specific about the topic you're exploring.`;
        addMessage({
          role: "assistant",
          content: noResultsMessage,
        });
      }
    } catch (error) {
      console.error("Literature search error:", error);
      const isNetworkError = error instanceof TypeError && error.message.includes('fetch');
      addMessage({
        role: "assistant",
        content: isNetworkError
          ? "Unable to connect to the server. Please check your internet connection and try again."
          : (error instanceof Error ? error.message : "I encountered an error searching the literature. Please try again in a moment."),
      });
    } finally {
      setIsSearchingLiterature(false);
    }
  };

  const handleGenerateOutput = () => {
    setShowOutputModal(true);
    setGeneratedOutput(null);
  };

  const executeGenerateOutput = async (outputType: "statement" | "introduction" | "brief") => {
    setIsGenerating(true);
    setSelectedOutputType(outputType);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getRequestHeaders() },
        body: JSON.stringify({
          outputType,
          messages: session.messages,
          literatureFindings: session.literatureFindings,
          analysisResults: session.analysisResults,
          subfield: session.subfield,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to generate output");
      }

      setGeneratedOutput({
        content: data.content,
        type: outputType,
      });

      // Calculate version number based on existing artifacts of this type
      const existingOfType = session.puzzleArtifacts.filter(a => a.type === outputType);
      const nextVersion = existingOfType.length + 1;

      // Also add as an artifact to the session
      addArtifact({
        type: outputType,
        content: data.content,
        version: nextVersion,
      });
    } catch (error) {
      console.error("Generate output error:", error);
      setGeneratedOutput({
        content: "Failed to generate output. Please try again.",
        type: "error",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Could add a toast notification here
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const handleExportConversation = () => {
    const exportData = {
      ...session,
      exportedAt: new Date().toISOString(),
      version: "1.0",
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scholarly-ideas-session-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportModal(false);
    setSuccessMessage("Session exported successfully!");
  };

  const handleExportOutputsOnly = () => {
    const exportData = {
      puzzleArtifacts: session.puzzleArtifacts,
      exportedAt: new Date().toISOString(),
      version: "1.0",
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scholarly-ideas-outputs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportModal(false);
    setSuccessMessage("Outputs exported successfully!");
  };

  const handleExportOutputsPDF = () => {
    if (session.puzzleArtifacts.length === 0) return;

    // Create a new PDF document
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = margin;

    // Helper function to add text with word wrap
    const addWrappedText = (text: string, fontSize: number, isBold: boolean = false) => {
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", isBold ? "bold" : "normal");
      const lines = doc.splitTextToSize(text, contentWidth);
      const lineHeight = fontSize * 0.4;

      for (const line of lines) {
        if (yPos + lineHeight > pageHeight - margin) {
          doc.addPage();
          yPos = margin;
        }
        doc.text(line, margin, yPos);
        yPos += lineHeight;
      }
      yPos += 2; // Add spacing after paragraph
    };

    // Helper function to add a section divider
    const addSectionDivider = () => {
      yPos += 5;
      if (yPos > pageHeight - margin - 10) {
        doc.addPage();
        yPos = margin;
      }
    };

    // Title - Editorial burgundy
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(124, 45, 54); // Burgundy
    doc.text("Scholarly Ideas", margin, yPos);
    yPos += 12;

    // Subtitle
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("Generated Outputs", margin, yPos);
    yPos += 8;

    // Export metadata
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text(`Exported: ${new Date().toLocaleString()}`, margin, yPos);
    yPos += 10;

    // Reset text color
    doc.setTextColor(0, 0, 0);

    // Add each generated output
    for (const artifact of session.puzzleArtifacts) {
      addSectionDivider();

      // Output type header
      const typeLabel = artifact.type === "statement" ? "Puzzle Statement" :
        artifact.type === "introduction" ? "Introduction Draft" :
          artifact.type === "brief" ? "Research Brief" : artifact.type;

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(124, 45, 54); // Burgundy
      doc.text(`${typeLabel} (v${artifact.version})`, margin, yPos);
      yPos += 8;
      doc.setTextColor(0, 0, 0);

      // Output content
      addWrappedText(artifact.content, 11);
      addSectionDivider();
    }

    // Footer on all pages
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${i} of ${pageCount} | Generated by Scholarly Ideas`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );
    }

    // Save the PDF
    doc.save(`scholarly-ideas-outputs-${new Date().toISOString().slice(0, 10)}.pdf`);
    setShowExportModal(false);
    setSuccessMessage("Outputs PDF exported successfully!");
  };

  const handleExportPDF = () => {
    // Create a new PDF document
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - 2 * margin;
    let yPos = margin;

    // Helper function to add text with word wrap
    const addWrappedText = (text: string, fontSize: number, isBold: boolean = false) => {
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", isBold ? "bold" : "normal");
      const lines = doc.splitTextToSize(text, contentWidth);
      const lineHeight = fontSize * 0.4;

      for (const line of lines) {
        if (yPos + lineHeight > pageHeight - margin) {
          doc.addPage();
          yPos = margin;
        }
        doc.text(line, margin, yPos);
        yPos += lineHeight;
      }
      yPos += 2; // Add spacing after paragraph
    };

    // Helper function to add a section divider
    const addSectionDivider = () => {
      yPos += 5;
      if (yPos > pageHeight - margin - 10) {
        doc.addPage();
        yPos = margin;
      }
    };

    // Title - Editorial burgundy
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(124, 45, 54); // Burgundy
    doc.text("Scholarly Ideas", margin, yPos);
    yPos += 12;

    // Subtitle
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text("Research Puzzle Development Session", margin, yPos);
    yPos += 8;

    // Session metadata
    doc.setFontSize(10);
    doc.setTextColor(150, 150, 150);
    doc.text(`Exported: ${new Date().toLocaleString()}`, margin, yPos);
    yPos += 5;
    if (session.subfield) {
      doc.text(`Subfield: ${session.subfield}`, margin, yPos);
      yPos += 5;
    }
    doc.text(`Mode: ${session.mode === 'idea' ? 'I have an idea' : session.mode === 'data' ? 'I have data' : "I'm exploring"}`, margin, yPos);
    yPos += 10;

    // Reset text color
    doc.setTextColor(0, 0, 0);

    // Add generated outputs if any
    if (session.puzzleArtifacts.length > 0) {
      addSectionDivider();
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(124, 45, 54); // Burgundy
      doc.text("Generated Outputs", margin, yPos);
      yPos += 10;
      doc.setTextColor(0, 0, 0);

      for (const artifact of session.puzzleArtifacts) {
        // Output type header
        const typeLabel = artifact.type === "statement" ? "Puzzle Statement" :
          artifact.type === "introduction" ? "Introduction Draft" :
            "Research Brief";

        addWrappedText(`${typeLabel} (v${artifact.version})`, 14, true);
        yPos += 2;

        // Output content
        addWrappedText(artifact.content, 11);
        addSectionDivider();
      }
    }

    // Add literature findings if any
    if (session.literatureFindings.length > 0) {
      addSectionDivider();
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(124, 45, 54); // Burgundy
      doc.text("Literature Findings", margin, yPos);
      yPos += 10;
      doc.setTextColor(0, 0, 0);

      for (const paper of session.literatureFindings) {
        addWrappedText(`• ${paper.title}`, 11, true);
        addWrappedText(`  ${paper.authors.join(", ")} (${paper.year})`, 10);
        if (paper.isCrossDisciplinary && paper.discipline) {
          doc.setTextColor(100, 100, 100);
          addWrappedText(`  Cross-disciplinary: ${paper.discipline}`, 9);
          doc.setTextColor(0, 0, 0);
        }
        yPos += 2;
      }
    }

    // Add conversation summary
    if (session.messages.length > 1) {
      addSectionDivider();
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(124, 45, 54); // Burgundy
      doc.text("Conversation Summary", margin, yPos);
      yPos += 10;
      doc.setTextColor(0, 0, 0);

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(`${session.messages.length} messages exchanged`, margin, yPos);
      yPos += 8;
      doc.setTextColor(0, 0, 0);

      // Add key user messages (filter to user role only, limit to prevent huge PDFs)
      const userMessages = session.messages.filter(m => m.role === 'user').slice(0, 10);
      for (const msg of userMessages) {
        addWrappedText(`You: ${msg.content.substring(0, 300)}${msg.content.length > 300 ? '...' : ''}`, 10);
        yPos += 3;
      }
    }

    // Footer on last page
    const pageCount = doc.internal.pages.length - 1;
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${i} of ${pageCount} | Generated by Scholarly Ideas`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );
    }

    // Save the PDF
    doc.save(`scholarly-ideas-${new Date().toISOString().slice(0, 10)}.pdf`);
    setShowExportModal(false);
    setSuccessMessage("PDF exported successfully!");
  };

  const handleImportSession = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importedSession = JSON.parse(content);

        // Validate the imported data has required fields
        if (!importedSession.id || !importedSession.mode || !importedSession.messages) {
          throw new Error("Invalid session file format");
        }

        importSession(importedSession);
        setShowImportModal(false);

        // Add a welcome back message
        addMessage({
          role: "assistant",
          content: `Willkommen zurück! Ich habe Ihre vorherige Sitzung vom ${importedSession.exportedAt ? new Date(importedSession.exportedAt).toLocaleDateString("de-DE") : "einem früheren Datum"} wiederhergestellt. Sie hatten ${importedSession.messages.length} Nachrichten in Ihrer Konversation. Lassen Sie uns dort weitermachen, wo Sie aufgehört haben.`,
        });
      } catch (error) {
        console.error("Import error:", error);
        alert("Failed to import session. Please check the file format.");
      }
    };
    reader.readAsText(file);

    // Reset the file input
    event.target.value = "";
  };

  return (
    <div className="h-screen flex flex-col bg-ivory">
      {/* Success Toast - Editorial style */}
      {successMessage && (
        <div className="fixed top-4 right-4 z-50 animate-fade-in">
          <div className="bg-cream border border-parchment-dark text-ink px-5 py-3 rounded-sm shadow-editorial-md flex items-center gap-3">
            <svg className="w-5 h-5 text-burgundy" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-body text-body-sm">{successMessage}</span>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-slate-muted hover:text-ink transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header - Editorial style */}
      <header className="border-b border-parchment bg-ivory px-6 py-4 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-6">
          <button
            onClick={handleNavigateHome}
            className="font-display text-display-md text-ink hover:text-burgundy transition-colors"
          >
            Scholarly Ideas
          </button>
          {session.subfield && (
            <span className="font-sans text-caption uppercase tracking-widest text-burgundy bg-burgundy/5 px-3 py-1.5 border border-burgundy/20 rounded-sm">
              {session.subfield}
            </span>
          )}
        </div>

        <div className="relative flex items-center gap-2">
          {/* Export button */}
          <button
            onClick={() => setShowExportModal(true)}
            className="p-2.5 rounded-sm text-slate hover:text-ink hover:bg-cream transition-colors"
            aria-label="Export session"
            title="Export session"
          >
            <Download className="h-5 w-5" strokeWidth={1.5} />
          </button>

          {/* Import button */}
          <button
            onClick={() => setShowImportModal(true)}
            className="p-2.5 rounded-sm text-slate hover:text-ink hover:bg-cream transition-colors"
            aria-label="Import session"
            title="Import session"
          >
            <FileUp className="h-5 w-5" strokeWidth={1.5} />
          </button>

          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              "p-2.5 rounded-sm transition-colors",
              showSettings
                ? "bg-burgundy text-ivory"
                : "text-slate hover:text-ink hover:bg-cream"
            )}
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" strokeWidth={1.5} />
          </button>

          {/* Settings dropdown - Editorial style */}
          {showSettings && (
            <div className="absolute top-full right-0 mt-2 bg-white rounded-sm shadow-editorial-lg border border-parchment p-5 z-20 w-72">
              <div className="space-y-5">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="font-sans text-body-sm text-ink">Be Direct</span>
                  <button
                    onClick={() =>
                      updateSettings({
                        beDirectMode: !session.settings.beDirectMode,
                      })
                    }
                    className={cn(
                      "w-11 h-6 rounded-sm transition-colors",
                      session.settings.beDirectMode
                        ? "bg-burgundy"
                        : "bg-parchment"
                    )}
                  >
                    <div
                      className={cn(
                        "w-5 h-5 bg-white rounded-sm transition-transform mx-0.5 shadow-editorial",
                        session.settings.beDirectMode && "translate-x-5"
                      )}
                    />
                  </button>
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="font-sans text-body-sm text-ink">Teach Me</span>
                  <button
                    onClick={() =>
                      updateSettings({
                        teachMeMode: !session.settings.teachMeMode,
                      })
                    }
                    className={cn(
                      "w-11 h-6 rounded-sm transition-colors",
                      session.settings.teachMeMode ? "bg-burgundy" : "bg-parchment"
                    )}
                  >
                    <div
                      className={cn(
                        "w-5 h-5 bg-white rounded-sm transition-transform mx-0.5 shadow-editorial",
                        session.settings.teachMeMode && "translate-x-5"
                      )}
                    />
                  </button>
                </label>

                {/* AI Provider Settings */}
                <div className="pt-4 border-t border-parchment">
                  <button
                    onClick={() => {
                      setShowSettings(false);
                      setShowAISettings(true);
                    }}
                    className="w-full flex items-center justify-between text-left group"
                  >
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-slate group-hover:text-burgundy transition-colors" strokeWidth={1.5} />
                      <span className="font-sans text-body-sm text-ink group-hover:text-burgundy transition-colors">AI Provider</span>
                    </div>
                    <span className="font-sans text-body-xs text-slate">
                      {PROVIDER_CONFIGS[aiSettings.provider]?.name?.split(' ')[0] || 'Configure'}
                    </span>
                  </button>
                  {!isAIConfigured && (
                    <p className="font-sans text-body-xs text-burgundy mt-1">
                      Configure API key to continue
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* AI Settings Modal */}
          {showAISettings && (
            <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-sm shadow-editorial-lg w-full max-w-lg mx-4 border border-parchment max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between p-5 border-b border-parchment">
                  <h3 className="font-display text-display-md text-ink">AI Provider Settings</h3>
                  <button
                    onClick={() => setShowAISettings(false)}
                    className="p-1 text-slate hover:text-ink transition-colors"
                  >
                    <X className="h-5 w-5" strokeWidth={1.5} />
                  </button>
                </div>
                <div className="p-5">
                  <AIProviderSettings onClose={() => setShowAISettings(false)} />
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Literature search modal - Editorial style */}
      {showSearchModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg p-6 w-full max-w-md mx-4 border border-parchment">
            <h3 className="font-display text-display-md text-ink mb-4">Search Literature</h3>
            <p className="font-body text-body-sm text-slate mb-5">
              Enter keywords or a topic to search for relevant academic papers via Semantic Scholar.
            </p>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  executeSearchLiterature(searchQuery);
                }
              }}
              placeholder="e.g., team conflict performance"
              className="input-editorial mb-5"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSearchModal(false)}
                className="btn-editorial-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => executeSearchLiterature(searchQuery)}
                disabled={!searchQuery.trim()}
                className={cn(
                  searchQuery.trim()
                    ? "btn-editorial-primary"
                    : "btn-editorial bg-parchment text-slate-muted cursor-not-allowed"
                )}
              >
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Output generation modal - Editorial style */}
      {showOutputModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col border border-parchment">
            {/* Modal header */}
            <div className="p-6 border-b border-parchment">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-display-md text-ink">Generate Output</h3>
                <button
                  onClick={() => setShowOutputModal(false)}
                  className="text-slate-muted hover:text-ink transition-colors"
                >
                  <X className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </div>
              {!generatedOutput && (
                <p className="font-body text-body-sm text-slate mt-2">
                  Choose the type of output you&apos;d like to generate from your conversation.
                </p>
              )}
            </div>

            {/* Modal content */}
            <div className="flex-1 overflow-y-auto p-6">
              {!generatedOutput && !isGenerating && (
                <div className="grid gap-4">
                  {/* Puzzle Statement option */}
                  <button
                    onClick={() => executeGenerateOutput("statement")}
                    className="text-left p-5 border border-parchment rounded-sm hover:border-burgundy hover:bg-burgundy/5 transition-all duration-300"
                  >
                    <h4 className="font-display text-display-md text-ink mb-1">Puzzle Statement</h4>
                    <p className="font-body text-body-sm text-slate">
                      A polished 1-2 paragraph statement ready for your paper introduction.
                    </p>
                  </button>

                  {/* Introduction Draft option */}
                  <button
                    onClick={() => executeGenerateOutput("introduction")}
                    className="text-left p-5 border border-parchment rounded-sm hover:border-burgundy hover:bg-burgundy/5 transition-all duration-300"
                  >
                    <h4 className="font-display text-display-md text-ink mb-1">Introduction Draft</h4>
                    <p className="font-body text-body-sm text-slate">
                      A 2-3 page introduction draft with literature review and framing.
                    </p>
                  </button>

                  {/* Research Brief option */}
                  <button
                    onClick={() => executeGenerateOutput("brief")}
                    className="text-left p-5 border border-parchment rounded-sm hover:border-burgundy hover:bg-burgundy/5 transition-all duration-300"
                  >
                    <h4 className="font-display text-display-md text-ink mb-1">Research Brief</h4>
                    <p className="font-body text-body-sm text-slate">
                      A comprehensive 5-section document with puzzle, significance, literature, evidence needed, and approach.
                    </p>
                  </button>
                </div>
              )}

              {isGenerating && (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 text-burgundy animate-spin mb-4" />
                  <p className="font-body text-body-md text-slate">Generating your {selectedOutputType === "statement" ? "puzzle statement" : selectedOutputType === "introduction" ? "introduction draft" : "research brief"}...</p>
                </div>
              )}

              {generatedOutput && !isGenerating && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-display-md text-ink">
                      {generatedOutput.type === "statement" ? "Puzzle Statement" :
                        generatedOutput.type === "introduction" ? "Introduction Draft" :
                          generatedOutput.type === "brief" ? "Research Brief" : "Output"}
                    </h4>
                    <button
                      onClick={() => copyToClipboard(generatedOutput.content)}
                      className="font-sans text-body-sm text-burgundy hover:text-burgundy-900 transition-colors"
                    >
                      Copy to clipboard
                    </button>
                  </div>
                  <div className="prose prose-sm max-w-none bg-cream rounded-sm p-5 border border-parchment">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        p: ({ children }) => (
                          <p className="mb-3 leading-relaxed">{children}</p>
                        ),
                        h1: ({ children }) => (
                          <h1 className="text-xl font-display font-medium mb-3 mt-4 first:mt-0">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-lg font-display font-medium mb-3 mt-4 first:mt-0">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-lg font-display font-medium mb-2 mt-3 first:mt-0">{children}</h3>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>
                        ),
                        li: ({ children }) => (
                          <li className="leading-relaxed">{children}</li>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-semibold">{children}</strong>
                        ),
                        em: ({ children }) => (
                          <em className="italic">{children}</em>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-parchment pl-4 italic my-3">
                            {children}
                          </blockquote>
                        ),
                      }}
                    >
                      {generatedOutput.content}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="p-6 border-t border-parchment flex justify-between">
              {generatedOutput && !isGenerating ? (
                <>
                  <button
                    onClick={() => setGeneratedOutput(null)}
                    className="btn-editorial-secondary"
                  >
                    Generate Another
                  </button>
                  <button
                    onClick={() => setShowOutputModal(false)}
                    className="btn-editorial-primary"
                  >
                    Done
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowOutputModal(false)}
                  className="btn-editorial-secondary ml-auto"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export modal - Editorial style */}
      {showExportModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg p-6 w-full max-w-md mx-4 border border-parchment">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-display-md text-ink">Export Session</h3>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-slate-muted hover:text-ink transition-colors"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
            <p className="font-body text-body-sm text-slate mb-6">
              Choose what you&apos;d like to export from your session.
            </p>
            <div className="space-y-3">
              <button
                onClick={handleExportConversation}
                className="w-full text-left p-5 border border-parchment rounded-sm hover:border-burgundy hover:bg-burgundy/5 transition-all duration-300"
              >
                <h4 className="font-display text-display-md text-ink mb-1">Export Conversation</h4>
                <p className="font-body text-body-sm text-slate">
                  Full session with all messages, analysis results, and literature findings. Can be re-imported later.
                </p>
              </button>
              <div
                className={cn(
                  "w-full text-left p-5 border border-parchment rounded-sm transition-all duration-300",
                  session.puzzleArtifacts.length === 0 && "opacity-50"
                )}
              >
                <h4 className="font-display text-display-md text-ink mb-1">Export Outputs Only</h4>
                <p className="font-body text-body-sm text-slate mb-3">
                  {session.puzzleArtifacts.length > 0
                    ? `Export ${session.puzzleArtifacts.length} generated artifact(s) only.`
                    : "No outputs generated yet."}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportOutputsOnly}
                    disabled={session.puzzleArtifacts.length === 0}
                    className={cn(
                      "flex-1 px-4 py-2 font-sans text-body-sm rounded-sm border transition-all duration-300",
                      session.puzzleArtifacts.length > 0
                        ? "border-parchment-dark hover:border-burgundy hover:bg-burgundy/5 text-ink"
                        : "cursor-not-allowed border-parchment text-slate-muted"
                    )}
                  >
                    JSON Format
                  </button>
                  <button
                    onClick={handleExportOutputsPDF}
                    disabled={session.puzzleArtifacts.length === 0}
                    className={cn(
                      "flex-1 px-4 py-2 font-sans text-body-sm rounded-sm border transition-all duration-300 flex items-center justify-center gap-1",
                      session.puzzleArtifacts.length > 0
                        ? "border-parchment-dark hover:border-burgundy hover:bg-burgundy/5 text-ink"
                        : "cursor-not-allowed border-parchment text-slate-muted"
                    )}
                  >
                    <FileDown className="h-4 w-4" strokeWidth={1.5} />
                    PDF Format
                  </button>
                </div>
              </div>
              <button
                onClick={handleExportPDF}
                className="w-full text-left p-5 border border-parchment rounded-sm hover:border-burgundy hover:bg-burgundy/5 transition-all duration-300"
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileDown className="h-5 w-5 text-burgundy" strokeWidth={1.5} />
                  <h4 className="font-display text-display-md text-ink">Export as PDF</h4>
                </div>
                <p className="font-body text-body-sm text-slate">
                  Polished, professional PDF document with outputs, literature findings, and conversation summary.
                </p>
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowExportModal(false)}
                className="btn-editorial-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import modal - Editorial style */}
      {showImportModal && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg p-6 w-full max-w-md mx-4 border border-parchment">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-display-md text-ink">Import Session</h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-muted hover:text-ink transition-colors"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
            <p className="font-body text-body-sm text-slate mb-6">
              Import a previously exported session to continue where you left off.
            </p>
            <div className="border-2 border-dashed border-parchment-dark rounded-sm p-10 text-center bg-cream/50">
              <FileUp className="h-12 w-12 text-slate-muted mx-auto mb-4" strokeWidth={1.5} />
              <p className="font-body text-body-sm text-slate mb-5">
                Select a JSON file to import
              </p>
              <label className="cursor-pointer">
                <span className="btn-editorial-primary">
                  Choose File
                </span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportSession}
                  className="hidden"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowImportModal(false)}
                className="btn-editorial-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Changes Warning Modal - Editorial style */}
      {showUnsavedWarning && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg p-6 w-full max-w-md mx-4 border border-parchment">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-display-md text-ink">Unsaved Changes</h3>
              <button
                onClick={() => setShowUnsavedWarning(false)}
                className="text-slate-muted hover:text-ink transition-colors"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
            <p className="font-body text-body-sm text-slate mb-6">
              You have unsaved work in this session. Would you like to export your session before leaving?
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setShowUnsavedWarning(false);
                  setShowExportModal(true);
                }}
                className="w-full btn-editorial-primary py-3"
              >
                Export First
              </button>
              <button
                onClick={() => {
                  setShowUnsavedWarning(false);
                  router.push('/');
                }}
                className="w-full btn-editorial bg-gold text-ink border-gold hover:bg-gold-light py-3"
              >
                Leave Without Saving
              </button>
              <button
                onClick={() => setShowUnsavedWarning(false)}
                className="w-full btn-editorial-ghost py-3"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Details Modal - Editorial style */}
      {selectedFileDetails && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg max-w-md w-full mx-4 p-6 border border-parchment">
            <div className="flex justify-between items-center mb-5">
              <h2 className="font-display text-display-md text-ink flex items-center gap-2">
                <FileText className="h-5 w-5 text-burgundy" strokeWidth={1.5} />
                File Details
              </h2>
              <button
                onClick={() => setSelectedFileDetails(null)}
                className="text-slate-muted hover:text-ink transition-colors"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">File Name</label>
                <p className="font-body text-body-md text-ink font-medium mt-1">{selectedFileDetails.name}</p>
              </div>

              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Type</label>
                <p className="font-body text-body-md text-ink mt-1">{selectedFileDetails.type}</p>
              </div>

              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Size</label>
                <p className="font-body text-body-md text-ink mt-1">
                  {selectedFileDetails.size < 1024
                    ? `${selectedFileDetails.size} bytes`
                    : selectedFileDetails.size < 1024 * 1024
                      ? `${(selectedFileDetails.size / 1024).toFixed(1)} KB`
                      : `${(selectedFileDetails.size / (1024 * 1024)).toFixed(1)} MB`
                  }
                </p>
              </div>

              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Uploaded At</label>
                <p className="font-body text-body-md text-ink mt-1">{new Date(selectedFileDetails.uploadedAt).toLocaleString()}</p>
              </div>

              {selectedFileDetails.summary && (
                <div>
                  <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Summary</label>
                  <p className="font-body text-body-sm text-slate mt-1">{selectedFileDetails.summary}</p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  removeFile(selectedFileDetails.id);
                  setSelectedFileDetails(null);
                }}
                className="btn-editorial bg-error/10 text-error border-error/30 hover:bg-error/20"
              >
                Remove File
              </button>
              <button
                onClick={() => setSelectedFileDetails(null)}
                className="btn-editorial-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paper Details Modal - Editorial style */}
      {selectedPaperDetails && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg max-w-lg w-full mx-4 p-6 max-h-[80vh] overflow-y-auto border border-parchment">
            <div className="flex justify-between items-start mb-5">
              <div className="flex items-center gap-2 pr-4">
                <BookOpen className="h-5 w-5 text-burgundy flex-shrink-0" strokeWidth={1.5} />
                <h2 className="font-display text-display-md text-ink">Paper Details</h2>
                <div className="flex gap-1 ml-2">
                  {selectedPaperDetails.journalTier === "UTD24" && (
                    <span className="px-2 py-0.5 font-sans text-caption font-medium bg-gold/20 text-gold-muted border border-gold/30 rounded-sm">
                      UTD24
                    </span>
                  )}
                  {selectedPaperDetails.journalTier === "Top Disciplinary" && (
                    <span className="px-2 py-0.5 font-sans text-caption font-medium bg-burgundy/10 text-burgundy border border-burgundy/20 rounded-sm">
                      Top Disciplinary
                    </span>
                  )}
                  {selectedPaperDetails.isClassic && (
                    <span className="px-2 py-0.5 font-sans text-caption font-medium bg-ink/10 text-ink border border-ink/20 rounded-sm">
                      Classic
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedPaperDetails(null)}
                className="text-slate-muted hover:text-ink flex-shrink-0 transition-colors"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Title</label>
                <p className="font-display text-body-lg text-ink font-medium mt-1 leading-snug">{selectedPaperDetails.title}</p>
              </div>

              {selectedPaperDetails.journal && (
                <div>
                  <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Journal</label>
                  <p className="font-body text-body-md text-ink mt-1 italic">{selectedPaperDetails.journal}</p>
                </div>
              )}

              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Authors</label>
                <p className="font-body text-body-md text-ink mt-1">{selectedPaperDetails.authors.join(", ")}</p>
              </div>

              <div className="flex gap-8 flex-wrap">
                <div>
                  <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Year</label>
                  <p className="font-body text-body-md text-ink mt-1">{selectedPaperDetails.year}</p>
                </div>
                {selectedPaperDetails.citationCount !== undefined && (
                  <div>
                    <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Citations</label>
                    <p className="font-body text-body-md text-ink mt-1">{selectedPaperDetails.citationCount.toLocaleString()}</p>
                  </div>
                )}
                {selectedPaperDetails.influentialCitationCount !== undefined && selectedPaperDetails.influentialCitationCount > 0 && (
                  <div>
                    <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Influential Citations</label>
                    <p className="font-body text-body-md text-ink mt-1">{selectedPaperDetails.influentialCitationCount.toLocaleString()}</p>
                  </div>
                )}
              </div>

              {selectedPaperDetails.isCrossDisciplinary && selectedPaperDetails.discipline && (
                <div>
                  <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Discipline</label>
                  <p className="font-body text-body-md text-burgundy mt-1 font-medium">{selectedPaperDetails.discipline} (Cross-disciplinary)</p>
                </div>
              )}

              {selectedPaperDetails.abstract && (
                <div>
                  <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Abstract</label>
                  <p className="font-body text-body-sm text-slate mt-1 leading-relaxed">{selectedPaperDetails.abstract}</p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-between items-center">
              {selectedPaperDetails.url && (
                <a
                  href={selectedPaperDetails.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-editorial-primary"
                >
                  View on Semantic Scholar
                </a>
              )}
              <button
                onClick={() => setSelectedPaperDetails(null)}
                className="btn-editorial-secondary ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Artifact Details Modal - Editorial style */}
      {selectedArtifactDetails && (
        <div className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-sm shadow-editorial-lg max-w-2xl w-full mx-4 p-6 max-h-[80vh] overflow-y-auto border border-parchment">
            <div className="flex justify-between items-start mb-5">
              <h2 className="font-display text-display-md text-ink flex items-center gap-2 pr-4">
                <FileOutput className="h-5 w-5 text-burgundy flex-shrink-0" strokeWidth={1.5} />
                {selectedArtifactDetails.type === "statement" ? "Puzzle Statement" :
                  selectedArtifactDetails.type === "introduction" ? "Introduction Draft" :
                    selectedArtifactDetails.type === "brief" ? "Research Brief" : "Output"}
                <span className="font-sans text-body-sm font-normal text-slate-muted">v{selectedArtifactDetails.version}</span>
              </h2>
              <button
                onClick={() => setSelectedArtifactDetails(null)}
                className="text-slate-muted hover:text-ink flex-shrink-0 transition-colors"
              >
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Created</label>
                <p className="font-body text-body-md text-ink mt-1">{new Date(selectedArtifactDetails.createdAt).toLocaleString()}</p>
              </div>

              <div>
                <label className="font-sans text-caption uppercase tracking-widest text-slate-muted">Content</label>
                <div className="mt-2 p-5 bg-cream rounded-sm border border-parchment max-h-[50vh] overflow-y-auto">
                  <p className="font-body text-body-sm text-ink whitespace-pre-wrap leading-relaxed">{selectedArtifactDetails.content}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => copyToClipboard(selectedArtifactDetails.content)}
                className="btn-editorial-primary"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setSelectedArtifactDetails(null)}
                className="btn-editorial-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden relative z-0">
        {/* Conversation area */}
        <div
          className={cn(
            "flex-1 flex flex-col transition-all duration-300",
            // On desktop, add margin when panel is open
            // On mobile, no margin needed since panel overlays
            !isMobile && isContextPanelOpen ? "md:mr-80" : ""
          )}
        >
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {session.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-parchment rounded-sm px-5 py-4 shadow-editorial">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-slate-muted rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-slate-muted rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-slate-muted rounded-full typing-dot" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area - Editorial style */}
          <div className="border-t border-parchment bg-ivory p-5">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              accept=".csv,.xlsx,.xls,.dta,.sav,.rds,.rda,.rdata,.txt,.pdf"
              className="hidden"
            />

            {/* Upload error message */}
            {uploadError && (
              <div className="mb-4 p-4 bg-error/5 border border-error/20 rounded-sm font-body text-body-sm text-error flex items-center justify-between">
                <span>{uploadError}</span>
                <button onClick={() => setUploadError(null)} className="text-error/70 hover:text-error">
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            )}

            {/* Action buttons - Editorial style */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={handleUpload}
                disabled={isUploading}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 font-sans text-body-sm rounded-sm transition-colors",
                  isUploading
                    ? "bg-parchment text-slate-muted cursor-not-allowed"
                    : "text-slate hover:bg-cream hover:text-ink"
                )}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" strokeWidth={1.5} />
                )}
                {isUploading ? "Uploading..." : "Upload File"}
              </button>
              <button
                onClick={handleSearchLiterature}
                disabled={isSearchingLiterature}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 font-sans text-body-sm rounded-sm transition-colors",
                  isSearchingLiterature
                    ? "bg-parchment text-slate-muted cursor-not-allowed"
                    : "text-slate hover:bg-cream hover:text-ink"
                )}
              >
                {isSearchingLiterature ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BookOpen className="h-4 w-4" strokeWidth={1.5} />
                )}
                {isSearchingLiterature ? "Searching literature..." : "Search Literature"}
              </button>
              <button
                onClick={handleGenerateOutput}
                className="flex items-center gap-2 px-4 py-2 font-sans text-body-sm text-slate hover:bg-cream hover:text-ink rounded-sm transition-colors"
              >
                <FileOutput className="h-4 w-4" strokeWidth={1.5} />
                Generate Output
              </button>
            </div>

            {/* Message input - Editorial style */}
            <div className="flex gap-4">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                className={cn(
                  "flex-1 resize-none rounded-sm border border-parchment-dark px-4 py-3",
                  "font-body text-body-md text-ink bg-white",
                  "focus:outline-none focus:ring-1 focus:ring-burgundy focus:border-burgundy",
                  "placeholder:text-slate-muted",
                  "shadow-editorial-inner"
                )}
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className={cn(
                  "px-5 py-3 rounded-sm transition-all duration-300",
                  "flex items-center justify-center",
                  input.trim() && !isLoading
                    ? "bg-burgundy text-ivory hover:bg-burgundy-900"
                    : "bg-parchment text-slate-muted cursor-not-allowed"
                )}
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Context panel toggle - Desktop: side toggle, Mobile: bottom button */}
        {isMobile ? (
          <button
            onClick={() => setIsContextPanelOpen(!isContextPanelOpen)}
            className={cn(
              "fixed bottom-28 right-4 z-20",
              "bg-burgundy text-ivory rounded-sm p-3 shadow-editorial-md",
              "hover:bg-burgundy-900 transition-colors",
              "flex items-center justify-center"
            )}
            aria-label={isContextPanelOpen ? "Close context panel" : "Open context panel"}
          >
            {isContextPanelOpen ? (
              <X className="h-5 w-5" strokeWidth={1.5} />
            ) : (
              <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
            )}
          </button>
        ) : (
          <button
            onClick={() => setIsContextPanelOpen(!isContextPanelOpen)}
            className={cn(
              "fixed right-0 top-1/2 -translate-y-1/2 z-10",
              "bg-white border border-parchment rounded-l-sm p-2 shadow-editorial",
              "hover:bg-cream transition-colors",
              isContextPanelOpen ? "right-80" : "right-0"
            )}
            aria-label={isContextPanelOpen ? "Close context panel" : "Open context panel"}
          >
            {isContextPanelOpen ? (
              <ChevronRight className="h-5 w-5 text-slate" strokeWidth={1.5} />
            ) : (
              <ChevronLeft className="h-5 w-5 text-slate" strokeWidth={1.5} />
            )}
          </button>
        )}

        {/* Mobile backdrop overlay */}
        {isMobile && isContextPanelOpen && (
          <div
            className="fixed inset-0 bg-ink/50 z-30"
            onClick={() => setIsContextPanelOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Context panel - Editorial style */}
        <aside
          className={cn(
            "fixed bg-ivory z-40 overflow-y-auto transition-transform duration-300",
            isMobile
              ? // Mobile: bottom sheet
              cn(
                "left-0 right-0 bottom-0 h-[70vh] rounded-t-sm border-t border-parchment shadow-editorial-lg",
                isContextPanelOpen ? "translate-y-0" : "translate-y-full"
              )
              : // Desktop: side panel
              cn(
                "right-0 top-[61px] bottom-0 w-80 border-l border-parchment",
                isContextPanelOpen ? "translate-x-0" : "translate-x-full"
              )
          )}
        >
          {/* Mobile drag handle */}
          {isMobile && (
            <div className="sticky top-0 bg-ivory pt-3 pb-2 px-5 border-b border-parchment">
              <div className="w-12 h-1 bg-parchment-dark rounded-full mx-auto mb-3" />
              <div className="flex items-center justify-between">
                <h2 className="font-display text-display-md text-ink">Context</h2>
                <button
                  onClick={() => setIsContextPanelOpen(false)}
                  className="p-2 text-slate-muted hover:text-ink transition-colors rounded-sm hover:bg-cream"
                  aria-label="Close panel"
                >
                  <X className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}

          <div className="p-5 space-y-8">
            {/* Uploaded files */}
            <section>
              <h3 className="font-sans text-caption uppercase tracking-widest text-slate-muted mb-4">
                Uploaded Files
              </h3>
              {session.uploadedFiles.length === 0 ? (
                <p className="font-body text-body-sm text-slate-muted italic">No files uploaded</p>
              ) : (
                <ul className="space-y-2">
                  {session.uploadedFiles.map((file) => (
                    <li
                      key={file.id}
                      className="font-body text-body-sm bg-white border border-parchment rounded-sm p-3 cursor-pointer hover:border-burgundy/50 transition-colors"
                      onClick={() => setSelectedFileDetails(file)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedFileDetails(file);
                        }
                      }}
                    >
                      <div className="font-medium text-ink truncate">
                        {file.name}
                      </div>
                      <div className="text-caption text-slate-muted">{file.type}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Analysis results */}
            <section>
              <h3 className="font-sans text-caption uppercase tracking-widest text-slate-muted mb-4">
                Analysis Results
              </h3>
              {session.analysisResults.length === 0 ? (
                <p className="font-body text-body-sm text-slate-muted italic">No analysis run</p>
              ) : (
                <ul className="space-y-2">
                  {session.analysisResults.map((result) => (
                    <li
                      key={result.id}
                      className="font-body text-body-sm bg-white border border-parchment rounded-sm p-3"
                    >
                      <div className="font-medium text-ink capitalize">
                        {result.type}
                      </div>
                      <p className="text-caption text-slate mt-1">
                        {result.summary}
                      </p>
                      {Array.isArray(result.details?.variables) ? (
                        <div className="mt-2 space-y-1">
                          <div className="text-caption font-medium text-slate">Variable Statistics:</div>
                          {(result.details.variables as Array<{ name: string; mean?: number; std?: number; median?: number; min?: number; max?: number; unique?: number; dtype: string }>).slice(0, 5).map((v, i) => (
                            <div key={i} className="text-caption text-slate-muted pl-2 border-l-2 border-parchment">
                              <span className="font-medium">{v.name}</span>
                              <span className="text-slate-muted"> ({v.dtype})</span>
                              {v.mean !== undefined && v.mean !== null && (
                                <div className="pl-2 font-mono">
                                  Mean: {v.mean.toFixed(2)},
                                  Std: {v.std?.toFixed(2) || 'N/A'},
                                  Med: {v.median?.toFixed(2) || 'N/A'}
                                </div>
                              )}
                              {v.unique !== undefined && (
                                <div className="pl-2">Unique values: {v.unique}</div>
                              )}
                            </div>
                          ))}
                          {(result.details.variables as Array<unknown>).length > 5 && (
                            <div className="text-caption text-slate-muted pl-2">
                              +{(result.details.variables as Array<unknown>).length - 5} more variables...
                            </div>
                          )}
                        </div>
                      ) : null}
                      {result.type === "anomaly" && Array.isArray(result.details?.anomalies) && (result.details.anomalies as Array<unknown>).length > 0 ? (
                        <div className="mt-2 space-y-1">
                          <div className="text-caption font-medium text-slate">Outliers Detected:</div>
                          {(result.details.anomalies as Array<{ variable: string; outlier_count: number; outlier_percentage: number }>).map((a, i) => (
                            <div key={i} className="text-caption text-gold pl-2 border-l-2 border-gold/30 font-mono">
                              <span className="font-medium">{a.variable}</span>: {a.outlier_count} outliers ({a.outlier_percentage.toFixed(1)}%)
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {result.type === "theme" && Array.isArray(result.details?.themes) && (result.details.themes as Array<unknown>).length > 0 ? (
                        <div className="mt-2 space-y-1">
                          <div className="text-caption font-medium text-slate">Themes Identified:</div>
                          {(result.details.themes as Array<{ theme: string; frequency: number; examples?: string[] }>).map((t, i) => (
                            <div key={i} className="text-caption text-burgundy pl-2 border-l-2 border-burgundy/30">
                              <span className="font-medium capitalize">{t.theme}</span>: {t.frequency} mentions
                            </div>
                          ))}
                          {typeof result.details.segment_count === 'number' ? (
                            <div className="text-caption text-slate-muted mt-1">
                              Analyzed {result.details.segment_count} text segments
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {result.type === "quotes" && Array.isArray(result.details?.quotes) && (result.details.quotes as Array<unknown>).length > 0 ? (
                        <div className="mt-2 space-y-2">
                          <div className="text-caption font-medium text-slate">Surprising Quotes:</div>
                          {(result.details.quotes as Array<{ text: string; source: string; type: string; context?: string }>).slice(0, 3).map((q, i) => (
                            <div key={i} className="text-caption text-ink pl-2 border-l-2 border-burgundy/30 space-y-1">
                              <div className="italic">&ldquo;{q.text.slice(0, 100)}{q.text.length > 100 ? "..." : ""}&rdquo;</div>
                              <div className="text-slate-muted text-[10px]">{q.source} &bull; {q.type}</div>
                            </div>
                          ))}
                          {(result.details.quotes as Array<unknown>).length > 3 ? (
                            <div className="text-caption text-slate-muted">
                              +{(result.details.quotes as Array<unknown>).length - 3} more quotes...
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {result.rigorWarnings.length > 0 && (
                        <div className="mt-2 text-caption text-gold">
                          ⚠️ {result.rigorWarnings.length} warning(s)
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Literature findings */}
            <section>
              <h3 className="font-sans text-caption uppercase tracking-widest text-slate-muted mb-4">
                Literature Findings
              </h3>
              {session.literatureFindings.length === 0 ? (
                <p className="font-body text-body-sm text-slate-muted italic">
                  No literature searched
                </p>
              ) : (
                <ul className="space-y-2">
                  {session.literatureFindings.map((paper) => (
                    <li
                      key={paper.id}
                      className="font-body text-body-sm bg-white border border-parchment rounded-sm p-3 cursor-pointer hover:border-burgundy/50 transition-colors"
                      onClick={() => setSelectedPaperDetails(paper)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedPaperDetails(paper);
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-ink leading-snug hover:text-burgundy flex-1">
                          {paper.title}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {paper.journalTier === "UTD24" && (
                            <span className="px-1.5 py-0.5 text-[10px] font-sans font-medium bg-gold/20 text-gold-muted rounded-sm">
                              UTD24
                            </span>
                          )}
                          {paper.journalTier === "Top Disciplinary" && (
                            <span className="px-1.5 py-0.5 text-[10px] font-sans font-medium bg-burgundy/10 text-burgundy rounded-sm">
                              Top
                            </span>
                          )}
                          {paper.isClassic && (
                            <span className="px-1.5 py-0.5 text-[10px] font-sans font-medium bg-ink/10 text-ink rounded-sm">
                              Classic
                            </span>
                          )}
                        </div>
                      </div>
                      {paper.journal && (
                        <div className="text-caption text-slate italic mt-1">
                          {paper.journal}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-1">
                        <div className="text-caption text-slate-muted">
                          {paper.authors.slice(0, 2).join(", ")}
                          {paper.authors.length > 2 && " et al."} ({paper.year})
                        </div>
                        {paper.citationCount !== undefined && (
                          <div className="text-caption text-slate-muted">
                            {paper.citationCount.toLocaleString()} cites
                          </div>
                        )}
                      </div>
                      {paper.isCrossDisciplinary && (
                        <div className="mt-1 text-caption text-burgundy">
                          Cross-disciplinary: {paper.discipline}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Generated outputs */}
            <section>
              <h3 className="font-sans text-caption uppercase tracking-widest text-slate-muted mb-4">
                Generated Outputs
              </h3>
              {session.puzzleArtifacts.length === 0 ? (
                <p className="font-body text-body-sm text-slate-muted italic">
                  No outputs generated
                </p>
              ) : (
                <ul className="space-y-2">
                  {session.puzzleArtifacts.map((artifact) => (
                    <li
                      key={artifact.id}
                      className="font-body text-body-sm bg-white border border-parchment rounded-sm p-3 cursor-pointer hover:border-burgundy/50 transition-colors"
                      onClick={() => setSelectedArtifactDetails(artifact)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedArtifactDetails(artifact);
                        }
                      }}
                    >
                      <div className="font-medium text-ink leading-snug hover:text-burgundy">
                        {artifact.type === "statement" ? "Puzzle Statement" :
                          artifact.type === "introduction" ? "Introduction Draft" :
                            artifact.type === "brief" ? "Research Brief" : artifact.type}
                        <span className="ml-2 text-caption text-slate-muted">v{artifact.version}</span>
                      </div>
                      <div className="text-caption text-slate-muted mt-1">
                        {new Date(artifact.createdAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Message bubble component - Editorial style
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex message-enter",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-sm px-5 py-4",
          isUser
            ? "bg-burgundy text-ivory shadow-editorial"
            : "bg-white border border-parchment text-ink shadow-editorial"
        )}
      >
        {isUser ? (
          <p className="font-body text-body-md whitespace-pre-wrap leading-relaxed">{message.content}</p>
        ) : (
          <div className="prose prose-sm prose-gray max-w-none font-body text-body-md leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                p: ({ children }) => (
                  <p className="mb-3 leading-relaxed">{children}</p>
                ),
                h1: ({ children }) => (
                  <h1 className="text-xl font-display font-medium mb-3 mt-4 first:mt-0">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-display font-medium mb-3 mt-4 first:mt-0">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-lg font-display font-medium mb-2 mt-3 first:mt-0">{children}</h3>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="leading-relaxed">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic">{children}</em>
                ),
                code: ({ children, className }) => {
                  // Block code if it has className (language specifier) or contains newlines
                  const isInline = !className && !String(children).includes('\n');
                  return isInline ? (
                    <code className="bg-slate-100 text-ink px-1.5 py-0.5 rounded text-sm font-mono">
                      {children}
                    </code>
                  ) : (
                    <code className="block bg-slate-100 text-ink p-3 rounded text-sm font-mono whitespace-pre-wrap">
                      {children}
                    </code>
                  );
                },
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-parchment pl-4 italic my-3">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-3">
                    <table className="min-w-full border border-parchment">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-parchment bg-parchment/50 px-3 py-2 text-left font-medium">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-parchment px-3 py-2">{children}</td>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        <div
          className={cn(
            "font-sans text-caption mt-3",
            isUser ? "text-ivory/60" : "text-slate-muted"
          )}
        >
          {formatTimestamp(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
