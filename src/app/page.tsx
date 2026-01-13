"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { SUBFIELDS, type EntryMode, type Subfield } from "@/types";
import { cn } from "@/lib/utils";
import { Lightbulb, Database, Compass, ChevronDown, Upload } from "lucide-react";

interface EntryModeCard {
  mode: EntryMode;
  title: string;
  description: string;
  icon: typeof Lightbulb;
}

const entryModes: EntryModeCard[] = [
  {
    mode: "idea",
    title: "I have an idea",
    description:
      "You have an observation or pattern that sparked your interest. Let's explore whether it's a genuine puzzle.",
    icon: Lightbulb,
  },
  {
    mode: "data",
    title: "I have data",
    description:
      "You have collected data and want to explore what stories it might tell. Let's discover what stands out.",
    icon: Database,
  },
  {
    mode: "exploring",
    title: "I'm exploring",
    description:
      "You're curious about a topic but don't have a specific direction yet. Let's discover together.",
    icon: Compass,
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const { initSession, importSession } = useSession();
  const [selectedSubfield, setSelectedSubfield] = useState<Subfield | "">("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleModeSelect = (mode: EntryMode) => {
    initSession(mode, selectedSubfield || undefined);
    router.push("/conversation");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.messages && Array.isArray(data.messages)) {
        importSession(data);
        router.push("/conversation");
      } else {
        alert("Invalid session file format. Please select a valid Scholarly Ideas export file.");
      }
    } catch {
      alert("Failed to import session. Please check the file format.");
    }

    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <main className="min-h-screen bg-ivory relative">
      {/* Subtle paper texture overlay */}
      <div className="paper-texture absolute inset-0" />

      {/* Header */}
      <header className="border-b border-parchment bg-ivory/95 backdrop-blur-sm sticky top-0 z-10 relative">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-display-md text-ink tracking-tight">
              Scholarly Ideas
            </h1>
            <div className="h-px w-24 bg-burgundy/30" />
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-20 relative">
        {/* Welcome heading - editorial style */}
        <div className="text-center mb-16">
          <p className="font-sans text-caption uppercase tracking-widest text-burgundy mb-4">
            Research Discovery
          </p>
          <h2 className="font-display text-display-xl text-ink mb-6 leading-tight">
            What brings you here today?
          </h2>
          <div className="editorial-divider max-w-xs mx-auto mb-6" />
          <p className="font-body text-body-lg text-slate max-w-2xl mx-auto leading-relaxed">
            Good research starts with genuine puzzles—empirical patterns that
            contradict or cannot be explained by existing theory. Let's develop
            yours.
          </p>
        </div>

        {/* Subfield selector - editorial style */}
        <div className="flex justify-center mb-16">
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={cn(
                "flex items-center gap-3 px-5 py-3",
                "bg-white border border-parchment-dark rounded-sm",
                "hover:border-slate-muted transition-all duration-300",
                "font-sans text-body-sm text-ink",
                "shadow-editorial",
                isDropdownOpen && "ring-1 ring-burgundy border-burgundy"
              )}
            >
              <span className="text-slate-muted">Subfield:</span>
              <span className="font-medium">
                {selectedSubfield || "All areas"}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-slate-muted transition-transform duration-300",
                  isDropdownOpen && "rotate-180"
                )}
              />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-sm shadow-editorial-lg border border-parchment py-1 z-20 animate-fade-in">
                <button
                  onClick={() => {
                    setSelectedSubfield("");
                    setIsDropdownOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-5 py-2.5 font-sans text-body-sm",
                    "hover:bg-cream transition-colors duration-200",
                    !selectedSubfield && "bg-burgundy/5 text-burgundy font-medium"
                  )}
                >
                  All areas
                </button>
                {SUBFIELDS.map((subfield) => (
                  <button
                    key={subfield}
                    onClick={() => {
                      setSelectedSubfield(subfield);
                      setIsDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-5 py-2.5 font-sans text-body-sm",
                      "hover:bg-cream transition-colors duration-200",
                      selectedSubfield === subfield &&
                        "bg-burgundy/5 text-burgundy font-medium"
                    )}
                  >
                    {subfield}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Entry mode cards - editorial style */}
        <div className="grid md:grid-cols-3 gap-8">
          {entryModes.map((entry, index) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.mode}
                onClick={() => handleModeSelect(entry.mode)}
                className={cn(
                  "flex flex-col items-center text-center p-8",
                  "bg-white border border-parchment rounded-sm",
                  "shadow-editorial hover:shadow-editorial-md",
                  "hover:border-parchment-dark hover:-translate-y-1",
                  "transition-all duration-300 ease-out",
                  "focus:outline-none focus:ring-1 focus:ring-burgundy focus:ring-offset-2 focus:ring-offset-ivory",
                  "group stagger-reveal"
                )}
                style={{ animationDelay: `${index * 0.1 + 0.2}s` }}
              >
                <div
                  className={cn(
                    "w-14 h-14 rounded-sm flex items-center justify-center mb-5",
                    "bg-cream border border-parchment",
                    "text-burgundy",
                    "group-hover:bg-burgundy group-hover:text-ivory group-hover:border-burgundy",
                    "transition-all duration-300"
                  )}
                >
                  <Icon className="h-6 w-6" strokeWidth={1.5} />
                </div>
                <h3 className="font-display text-display-md text-ink mb-3">
                  {entry.title}
                </h3>
                <p className="font-body text-body-sm text-slate leading-relaxed">
                  {entry.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Footer note with import option - editorial style */}
        <div className="text-center mt-20">
          <div className="editorial-divider max-w-xs mx-auto mb-8" />
          <p className="font-body text-body-sm text-slate-muted mb-6 max-w-lg mx-auto">
            Your data and conversations are processed transiently and never stored
            on our servers.
            <br />
            <span className="font-medium text-slate">
              Remember to export your session regularly to save your progress.
            </span>
          </p>

          {/* Import previous session button - editorial style */}
          <button
            onClick={handleImportClick}
            className={cn(
              "inline-flex items-center gap-2 px-5 py-2.5",
              "font-sans text-body-sm text-burgundy",
              "border border-burgundy/30 rounded-sm",
              "hover:bg-burgundy/5 hover:border-burgundy/50",
              "transition-all duration-300",
              "focus:outline-none focus:ring-1 focus:ring-burgundy focus:ring-offset-2 focus:ring-offset-ivory"
            )}
          >
            <Upload className="h-4 w-4" strokeWidth={1.5} />
            Import previous session
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
            aria-label="Import session file"
          />
          <p className="font-body text-caption text-slate-muted mt-3">
            Lost your work? Import a previously exported session to continue.
          </p>
        </div>
      </div>

      {/* Footer accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-burgundy/20 to-transparent" />
    </main>
  );
}
