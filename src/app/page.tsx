"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { SUBFIELDS, type EntryMode, type Subfield } from "@/types";
import { cn } from "@/lib/utils";
import { Lightbulb, Database, Compass, ChevronDown } from "lucide-react";

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
  const { initSession } = useSession();
  const [selectedSubfield, setSelectedSubfield] = useState<Subfield | "">("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleModeSelect = (mode: EntryMode) => {
    initSession(mode, selectedSubfield || undefined);
    router.push("/conversation");
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-primary">Scholarly Ideas</h1>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        {/* Welcome heading */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            What brings you here today?
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Good research starts with genuine puzzles—empirical patterns that
            contradict or cannot be explained by existing theory. Let's develop
            yours.
          </p>
        </div>

        {/* Subfield selector */}
        <div className="flex justify-center mb-12">
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg border",
                "bg-white hover:bg-gray-50 transition-colors",
                "text-gray-700 text-sm",
                isDropdownOpen && "ring-2 ring-primary ring-offset-2"
              )}
            >
              <span className="text-gray-500">Subfield:</span>
              <span className="font-medium">
                {selectedSubfield || "All areas"}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-gray-400 transition-transform",
                  isDropdownOpen && "rotate-180"
                )}
              />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-20">
                <button
                  onClick={() => {
                    setSelectedSubfield("");
                    setIsDropdownOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-2 text-sm hover:bg-gray-50",
                    !selectedSubfield && "bg-primary/5 text-primary font-medium"
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
                      "w-full text-left px-4 py-2 text-sm hover:bg-gray-50",
                      selectedSubfield === subfield &&
                        "bg-primary/5 text-primary font-medium"
                    )}
                  >
                    {subfield}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Entry mode cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {entryModes.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.mode}
                onClick={() => handleModeSelect(entry.mode)}
                className={cn(
                  "flex flex-col items-center text-center p-8 rounded-xl",
                  "bg-white border border-gray-200 shadow-sm",
                  "hover:shadow-lg hover:-translate-y-1 transition-all duration-200",
                  "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                  "group"
                )}
              >
                <div
                  className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center mb-4",
                    "bg-primary/10 text-primary",
                    "group-hover:bg-primary group-hover:text-white transition-colors"
                  )}
                >
                  <Icon className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {entry.title}
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  {entry.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="text-center text-gray-500 text-sm mt-12">
          Your data and conversations are processed transiently and never stored
          on our servers.
          <br />
          Export your session at any time to save your progress.
        </p>
      </div>
    </main>
  );
}
