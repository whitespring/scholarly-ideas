"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { cn, formatTimestamp } from "@/lib/utils";
import type { Message } from "@/types";
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
  const { session, addMessage, updateSettings } = useSession();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  // Add opening prompt if no messages
  useEffect(() => {
    if (session.messages.length === 0 && session.mode) {
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
    // TODO: Implement file upload modal
    console.log("Upload clicked");
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
            {/* Action buttons */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={handleUpload}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Upload className="h-4 w-4" />
                Upload File
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
