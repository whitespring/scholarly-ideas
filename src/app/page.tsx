"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/context/SessionContext";
import { useAISettings } from "@/context/AISettingsContext";
import { SUBFIELDS, type EntryMode, type Subfield } from "@/types";
import { cn } from "@/lib/utils";
import { Lightbulb, Database, Compass, ChevronDown, Upload, Download, Settings, X } from "lucide-react";
import { AIProviderSettings } from "@/components/settings/AIProviderSettings";
import { PROVIDER_CONFIGS } from "@/lib/ai/config";

interface EntryModeCard {
  mode: EntryMode;
  title: string;
  description: string;
  icon: typeof Lightbulb;
}

const entryModes: EntryModeCard[] = [
  {
    mode: "idea",
    title: "Ich habe eine Idee",
    description:
      "Sie haben eine Beobachtung oder ein Muster, das Ihr Interesse geweckt hat. Lassen Sie uns erkunden, ob es ein genuines Puzzle ist.",
    icon: Lightbulb,
  },
  {
    mode: "data",
    title: "Ich habe Daten",
    description:
      "Sie haben Daten gesammelt und möchten erkunden, welche Geschichten sie erzählen könnten. Lassen Sie uns entdecken, was heraussticht.",
    icon: Database,
  },
  {
    mode: "exploring",
    title: "Ich erkunde",
    description:
      "Sie sind neugierig auf ein Thema, haben aber noch keine spezifische Richtung. Lassen Sie uns gemeinsam entdecken.",
    icon: Compass,
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const { session, initSession, importSession } = useSession();
  const { settings: aiSettings, isConfigured: isAIConfigured } = useAISettings();
  const [selectedSubfield, setSelectedSubfield] = useState<Subfield | "">("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if there's an existing session with content
  const hasExistingSession = session.messages.length > 0;

  const handleModeSelect = (mode: EntryMode) => {
    initSession(mode, selectedSubfield || undefined);
    router.push("/conversation");
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleExportSession = () => {
    const dataStr = JSON.stringify(session, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;
    const exportName = `scholarly-ideas-${new Date().toISOString().split("T")[0]}.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportName);
    linkElement.click();
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
        alert("Ungültiges Sitzungsdateiformat. Bitte wählen Sie eine gültige Scholarly Ideas Export-Datei.");
      }
    } catch {
      alert("Import der Sitzung fehlgeschlagen. Bitte überprüfen Sie das Dateiformat.");
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
            <div className="flex items-center gap-4">
              <div className="h-px w-24 bg-burgundy/30" />
              <button
                onClick={() => setShowAISettings(true)}
                className={cn(
                  "p-2.5 rounded-sm transition-colors",
                  !isAIConfigured
                    ? "text-burgundy bg-burgundy/10 hover:bg-burgundy/20"
                    : "text-slate hover:text-ink hover:bg-cream"
                )}
                aria-label="AI Settings"
                title={isAIConfigured ? `Using ${PROVIDER_CONFIGS[aiSettings.provider]?.name || 'AI'}` : "Configure AI Provider"}
              >
                <Settings className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </header>

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

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-6 py-20 relative">
        {/* Welcome heading - editorial style */}
        <div className="text-center mb-16">
          <p className="font-sans text-caption uppercase tracking-widest text-burgundy mb-4">
            Research Discovery
          </p>
          <h2 className="font-display text-display-xl text-ink mb-6 leading-tight">
            Was führt Sie heute hierher?
          </h2>
          <div className="editorial-divider max-w-xs mx-auto mb-6" />
          <p className="font-body text-body-lg text-slate max-w-2xl mx-auto leading-relaxed">
            Gute Forschung beginnt mit genuinen Puzzles—empirischen Mustern, die 
            bestehender Theorie widersprechen oder von ihr nicht erklärt werden können. 
            Lassen Sie uns Ihres entwickeln.
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
              <span className="text-slate-muted">Teilgebiet:</span>
              <span className="font-medium">
                {selectedSubfield || "Alle Bereiche"}
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
                  Alle Bereiche
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

        {/* Footer note with session options - editorial style */}
        <div className="text-center mt-20">
          <div className="editorial-divider max-w-xs mx-auto mb-8" />
          <p className="font-body text-body-sm text-slate-muted mb-6 max-w-lg mx-auto">
            Ihre Daten und Konversationen werden vorübergehend verarbeitet und niemals 
            auf unseren Servern gespeichert.
            <br />
            <span className="font-medium text-slate">
              Denken Sie daran, Ihre Sitzung regelmäßig zu exportieren, um Ihren Fortschritt zu speichern.
            </span>
          </p>

          {/* Session buttons - editorial style */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {/* Export current session - only show if there's content */}
            {hasExistingSession && (
              <button
                onClick={handleExportSession}
                className={cn(
                  "inline-flex items-center gap-2 px-5 py-2.5",
                  "font-sans text-body-sm text-ivory bg-burgundy",
                  "border border-burgundy rounded-sm",
                  "hover:bg-burgundy-dark",
                  "transition-all duration-300",
                  "focus:outline-none focus:ring-1 focus:ring-burgundy focus:ring-offset-2 focus:ring-offset-ivory"
                )}
              >
                <Download className="h-4 w-4" strokeWidth={1.5} />
                Aktuelle Sitzung exportieren
              </button>
            )}

            {/* Import previous session */}
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
              Sitzung importieren
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
            aria-label="Import session file"
          />

          {/* Continue existing session hint */}
          {hasExistingSession ? (
            <p className="font-body text-caption text-slate-muted mt-3">
              Sie haben eine aktive Sitzung mit {session.messages.length} Nachrichten.{" "}
              <button
                onClick={() => router.push("/conversation")}
                className="text-burgundy hover:underline"
              >
                Weiter arbeiten
              </button>
            </p>
          ) : (
            <p className="font-body text-caption text-slate-muted mt-3">
              Arbeit verloren? Importieren Sie eine zuvor exportierte Sitzung, um fortzufahren.
            </p>
          )}
        </div>
      </div>

      {/* Footer accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-burgundy/20 to-transparent" />
    </main>
  );
}
