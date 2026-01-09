"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { cn, formatTimestamp } from "@/lib/utils";
import type { Message, AnalysisResult } from "@/types";
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
} from "lucide-react";

// Opening prompts based on mode
const openingPrompts: Record<string, string> = {
  idea: "Tell me about the observation or pattern that sparked your interest. What have you noticed—in your data, in the field, or in your reading—that you find surprising or hard to explain?",
  data: "What is this data, and why did you collect it? Understanding the context will help us explore what it might tell us.",
  exploring:
    "What's been on your mind lately? What surprised you in your reading or observations? I'd love to hear what's captured your curiosity.",
};

export default function ConversationPage() {
  const router = useRouter();
  const { session, addMessage, updateSettings, addFile, addAnalysis, addLiterature } = useSession();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [isSearchingLiterature, setIsSearchingLiterature] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAddedOpeningMessage = useRef(false);

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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...session.messages, { role: "user", content: userMessage }],
          settings: session.settings,
          currentPhase: session.currentPhase,
          subfield: session.subfield,
          analysisContext: session.analysisResults,
          literatureContext: session.literatureFindings,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();
      addMessage(data.message);
    } catch (error) {
      console.error("Chat error:", error);
      addMessage({
        role: "assistant",
        content:
          "I apologize, but I encountered an error processing your message. Please try again.",
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
        content: `I've received your data file "${file.name}". Here's a quick summary:\n\n**File Details:**\n- ${data.summary.rows} observations (rows)\n- ${data.summary.columns} variables (columns)\n- Format: ${data.summary.file_type.toUpperCase()}\n\n${numericVars.length > 0 ? `**Numeric Variables:** ${numericVars.map((v: { name: string }) => v.name).join(", ")}\n\n` : ""}${categoricalVars.length > 0 ? `**Categorical Variables:** ${categoricalVars.map((v: { name: string }) => v.name).join(", ")}\n\n` : ""}What stands out to you in this data? What patterns or surprises did you notice when collecting it?`,
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
      setUploadError(error instanceof Error ? error.message : "Failed to upload file");
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
            type: "quote",
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          subfield: session.subfield,
          limit: 5,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to search literature");
      }

      if (data.papers && data.papers.length > 0) {
        addLiterature(data.papers);

        // Format papers for the message
        const papersList = data.papers.slice(0, 5).map((p: { title: string; authors: string[]; year: number; isCrossDisciplinary?: boolean; discipline?: string }) =>
          `- **${p.title}** (${p.authors.slice(0, 2).join(", ")}${p.authors.length > 2 ? " et al." : ""}, ${p.year})${p.isCrossDisciplinary ? ` [${p.discipline}]` : ""}`
        ).join("\n");

        addMessage({
          role: "assistant",
          content: `I found ${data.papers.length} relevant papers for "${query}":\n\n${papersList}\n\nHow do these relate to your research direction? Are there any papers here that surprise you or challenge your thinking?`,
          metadata: { phase: "literature", literatureTriggered: true },
        });
      } else {
        addMessage({
          role: "assistant",
          content: `I couldn't find papers matching "${query}". Try adjusting your search terms or being more specific about the topic you're exploring.`,
        });
      }
    } catch (error) {
      console.error("Literature search error:", error);
      addMessage({
        role: "assistant",
        content: "I encountered an error searching the literature. Please try again in a moment.",
      });
    } finally {
      setIsSearchingLiterature(false);
    }
  };

  const handleGenerateOutput = () => {
    // TODO: Implement output generation
    console.log("Generate output clicked");
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="text-2xl font-bold text-primary hover:opacity-80 transition-opacity"
          >
            Scholarly Ideas
          </button>
          {session.subfield && (
            <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
              {session.subfield}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              "p-2 rounded-lg transition-colors",
              showSettings
                ? "bg-primary text-white"
                : "text-gray-600 hover:bg-gray-100"
            )}
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>

          {/* Settings dropdown */}
          {showSettings && (
            <div className="absolute top-16 right-4 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-20 w-64">
              <div className="space-y-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-700">Be Direct</span>
                  <button
                    onClick={() =>
                      updateSettings({
                        beDirectMode: !session.settings.beDirectMode,
                      })
                    }
                    className={cn(
                      "w-10 h-6 rounded-full transition-colors",
                      session.settings.beDirectMode
                        ? "bg-primary"
                        : "bg-gray-300"
                    )}
                  >
                    <div
                      className={cn(
                        "w-4 h-4 bg-white rounded-full transition-transform mx-1",
                        session.settings.beDirectMode && "translate-x-4"
                      )}
                    />
                  </button>
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-gray-700">Teach Me</span>
                  <button
                    onClick={() =>
                      updateSettings({
                        teachMeMode: !session.settings.teachMeMode,
                      })
                    }
                    className={cn(
                      "w-10 h-6 rounded-full transition-colors",
                      session.settings.teachMeMode ? "bg-primary" : "bg-gray-300"
                    )}
                  >
                    <div
                      className={cn(
                        "w-4 h-4 bg-white rounded-full transition-transform mx-1",
                        session.settings.teachMeMode && "translate-x-4"
                      )}
                    />
                  </button>
                </label>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Literature search modal */}
      {showSearchModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Search Literature</h3>
            <p className="text-sm text-gray-600 mb-4">
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
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent mb-4"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowSearchModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => executeSearchLiterature(searchQuery)}
                disabled={!searchQuery.trim()}
                className={cn(
                  "px-4 py-2 text-sm rounded-lg transition-colors",
                  searchQuery.trim()
                    ? "bg-primary text-white hover:bg-primary-800"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                )}
              >
                Search
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Conversation area */}
        <div
          className={cn(
            "flex-1 flex flex-col transition-all duration-300",
            isContextPanelOpen ? "mr-80" : ""
          )}
        >
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {session.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full typing-dot" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-gray-200 bg-white p-4">
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
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
                <span>{uploadError}</span>
                <button onClick={() => setUploadError(null)} className="text-red-500 hover:text-red-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={handleUpload}
                disabled={isUploading}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors",
                  isUploading
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-600 hover:bg-gray-100"
                )}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {isUploading ? "Uploading..." : "Upload File"}
              </button>
              <button
                onClick={handleSearchLiterature}
                disabled={isSearchingLiterature}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors",
                  isSearchingLiterature
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-600 hover:bg-gray-100"
                )}
              >
                {isSearchingLiterature ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BookOpen className="h-4 w-4" />
                )}
                {isSearchingLiterature ? "Searching literature..." : "Search Literature"}
              </button>
              <button
                onClick={handleGenerateOutput}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <FileOutput className="h-4 w-4" />
                Generate Output
              </button>
            </div>

            {/* Message input */}
            <div className="flex gap-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                className={cn(
                  "flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3",
                  "focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent",
                  "placeholder:text-gray-400"
                )}
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className={cn(
                  "px-4 py-3 rounded-xl transition-colors",
                  "flex items-center justify-center",
                  input.trim() && !isLoading
                    ? "bg-primary text-white hover:bg-primary-800"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                )}
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Context panel toggle */}
        <button
          onClick={() => setIsContextPanelOpen(!isContextPanelOpen)}
          className={cn(
            "fixed right-0 top-1/2 -translate-y-1/2 z-10",
            "bg-white border border-gray-200 rounded-l-lg p-2 shadow-sm",
            "hover:bg-gray-50 transition-colors",
            isContextPanelOpen ? "right-80" : "right-0"
          )}
        >
          {isContextPanelOpen ? (
            <ChevronRight className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          )}
        </button>

        {/* Context panel */}
        <aside
          className={cn(
            "fixed right-0 top-[57px] bottom-0 w-80 bg-white border-l border-gray-200",
            "overflow-y-auto transition-transform duration-300",
            isContextPanelOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          <div className="p-4 space-y-6">
            {/* Uploaded files */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Uploaded Files
              </h3>
              {session.uploadedFiles.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No files uploaded</p>
              ) : (
                <ul className="space-y-2">
                  {session.uploadedFiles.map((file) => (
                    <li
                      key={file.id}
                      className="text-sm bg-gray-50 rounded-lg p-3"
                    >
                      <div className="font-medium text-gray-700 truncate">
                        {file.name}
                      </div>
                      <div className="text-xs text-gray-500">{file.type}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Analysis results */}
            <section>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Analysis Results
              </h3>
              {session.analysisResults.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No analysis run</p>
              ) : (
                <ul className="space-y-2">
                  {session.analysisResults.map((result) => (
                    <li
                      key={result.id}
                      className="text-sm bg-gray-50 rounded-lg p-3"
                    >
                      <div className="font-medium text-gray-700 capitalize">
                        {result.type}
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        {result.summary}
                      </p>
                      {/* Show variable statistics if available */}
                      {result.details?.variables && Array.isArray(result.details.variables) && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs font-medium text-gray-600">Variable Statistics:</div>
                          {(result.details.variables as Array<{name: string; mean?: number; std?: number; median?: number; min?: number; max?: number; unique?: number; dtype: string}>).slice(0, 5).map((v, i) => (
                            <div key={i} className="text-xs text-gray-500 pl-2 border-l-2 border-gray-200">
                              <span className="font-medium">{v.name}</span>
                              <span className="text-gray-400"> ({v.dtype})</span>
                              {v.mean !== undefined && v.mean !== null && (
                                <div className="pl-2">
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
                            <div className="text-xs text-gray-400 pl-2">
                              +{(result.details.variables as Array<unknown>).length - 5} more variables...
                            </div>
                          )}
                        </div>
                      )}
                      {/* Show anomaly details if available */}
                      {result.type === "anomaly" && result.details?.anomalies && Array.isArray(result.details.anomalies) && (result.details.anomalies as Array<unknown>).length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs font-medium text-gray-600">Outliers Detected:</div>
                          {(result.details.anomalies as Array<{variable: string; outlier_count: number; outlier_percentage: number}>).map((a, i) => (
                            <div key={i} className="text-xs text-orange-600 pl-2 border-l-2 border-orange-200">
                              <span className="font-medium">{a.variable}</span>: {a.outlier_count} outliers ({a.outlier_percentage.toFixed(1)}%)
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Show theme details if available */}
                      {result.type === "theme" && result.details?.themes && Array.isArray(result.details.themes) && (result.details.themes as Array<unknown>).length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs font-medium text-gray-600">Themes Identified:</div>
                          {(result.details.themes as Array<{theme: string; frequency: number; examples?: string[]}>).map((t, i) => (
                            <div key={i} className="text-xs text-purple-600 pl-2 border-l-2 border-purple-200">
                              <span className="font-medium capitalize">{t.theme}</span>: {t.frequency} mentions
                            </div>
                          ))}
                          {result.details.segment_count && (
                            <div className="text-xs text-gray-400 mt-1">
                              Analyzed {result.details.segment_count as number} text segments
                            </div>
                          )}
                        </div>
                      )}
                      {/* Show quote details if available */}
                      {result.type === "quote" && result.details?.quotes && Array.isArray(result.details.quotes) && (result.details.quotes as Array<unknown>).length > 0 && (
                        <div className="mt-2 space-y-2">
                          <div className="text-xs font-medium text-gray-600">Surprising Quotes:</div>
                          {(result.details.quotes as Array<{text: string; source: string; type: string; context?: string}>).slice(0, 3).map((q, i) => (
                            <div key={i} className="text-xs text-blue-700 pl-2 border-l-2 border-blue-200 space-y-1">
                              <div className="italic">&ldquo;{q.text.slice(0, 100)}{q.text.length > 100 ? "..." : ""}&rdquo;</div>
                              <div className="text-blue-500 text-[10px]">{q.source} &bull; {q.type}</div>
                            </div>
                          ))}
                          {(result.details.quotes as Array<unknown>).length > 3 && (
                            <div className="text-xs text-gray-400">
                              +{(result.details.quotes as Array<unknown>).length - 3} more quotes...
                            </div>
                          )}
                        </div>
                      )}
                      {result.rigorWarnings.length > 0 && (
                        <div className="mt-2 text-xs text-warning">
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
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Literature Findings
              </h3>
              {session.literatureFindings.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  No literature searched
                </p>
              ) : (
                <ul className="space-y-2">
                  {session.literatureFindings.map((paper) => (
                    <li
                      key={paper.id}
                      className="text-sm bg-gray-50 rounded-lg p-3"
                    >
                      <div className="font-medium text-gray-700 leading-snug">
                        {paper.title}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {paper.authors.slice(0, 3).join(", ")}
                        {paper.authors.length > 3 && " et al."} ({paper.year})
                      </div>
                      {paper.isCrossDisciplinary && (
                        <div className="mt-1 text-xs text-primary">
                          📚 {paper.discipline}
                        </div>
                      )}
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

// Message bubble component
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
          "max-w-[80%] rounded-2xl px-4 py-3 shadow-sm",
          isUser
            ? "bg-primary text-white rounded-br-md"
            : "bg-white border border-gray-200 text-gray-800 rounded-bl-md"
        )}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
        <div
          className={cn(
            "text-xs mt-2",
            isUser ? "text-primary-100" : "text-gray-400"
          )}
        >
          {formatTimestamp(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
