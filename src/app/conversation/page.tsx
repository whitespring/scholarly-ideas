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
  const { session, addMessage, updateSettings, addFile, addAnalysis } = useSession();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
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

    try {
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

  const handleSearchLiterature = () => {
    // TODO: Implement literature search
    console.log("Search literature clicked");
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
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                Search Literature
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
