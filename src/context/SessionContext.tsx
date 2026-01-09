"use client";

import React, { createContext, useContext, useReducer, useCallback } from "react";
import type {
  Session,
  EntryMode,
  Message,
  FileReference,
  AnalysisResult,
  LiteratureResult,
  PuzzleArtifact,
  ConversationPhase,
  SessionSettings,
} from "@/types";
import { generateId, getCurrentTimestamp } from "@/lib/utils";

// Action types
type SessionAction =
  | { type: "INIT_SESSION"; payload: { mode: EntryMode; subfield?: string } }
  | { type: "ADD_MESSAGE"; payload: Message }
  | { type: "ADD_FILE"; payload: FileReference }
  | { type: "REMOVE_FILE"; payload: string }
  | { type: "ADD_ANALYSIS"; payload: AnalysisResult }
  | { type: "ADD_LITERATURE"; payload: LiteratureResult[] }
  | { type: "ADD_ARTIFACT"; payload: PuzzleArtifact }
  | { type: "SET_PHASE"; payload: ConversationPhase }
  | { type: "ESCALATE_FEEDBACK" }
  | { type: "UPDATE_SETTINGS"; payload: Partial<SessionSettings> }
  | { type: "IMPORT_SESSION"; payload: Session }
  | { type: "RESET_SESSION" };

// Initial state
const createInitialSession = (): Session => ({
  id: generateId(),
  mode: "idea",
  messages: [],
  uploadedFiles: [],
  analysisResults: [],
  literatureFindings: [],
  puzzleArtifacts: [],
  settings: {
    beDirectMode: false,
    teachMeMode: false,
  },
  currentPhase: "opening",
  feedbackEscalation: 0,
  createdAt: getCurrentTimestamp(),
  lastModified: getCurrentTimestamp(),
});

// Reducer
function sessionReducer(state: Session, action: SessionAction): Session {
  const now = getCurrentTimestamp();

  switch (action.type) {
    case "INIT_SESSION":
      return {
        ...createInitialSession(),
        mode: action.payload.mode,
        subfield: action.payload.subfield,
      };

    case "ADD_MESSAGE":
      return {
        ...state,
        messages: [...state.messages, action.payload],
        lastModified: now,
      };

    case "ADD_FILE":
      return {
        ...state,
        uploadedFiles: [...state.uploadedFiles, action.payload],
        lastModified: now,
      };

    case "REMOVE_FILE":
      return {
        ...state,
        uploadedFiles: state.uploadedFiles.filter((f) => f.id !== action.payload),
        lastModified: now,
      };

    case "ADD_ANALYSIS":
      return {
        ...state,
        analysisResults: [...state.analysisResults, action.payload],
        lastModified: now,
      };

    case "ADD_LITERATURE":
      return {
        ...state,
        literatureFindings: [...state.literatureFindings, ...action.payload],
        lastModified: now,
      };

    case "ADD_ARTIFACT":
      return {
        ...state,
        puzzleArtifacts: [...state.puzzleArtifacts, action.payload],
        lastModified: now,
      };

    case "SET_PHASE":
      return {
        ...state,
        currentPhase: action.payload,
        lastModified: now,
      };

    case "ESCALATE_FEEDBACK":
      return {
        ...state,
        feedbackEscalation: Math.min(state.feedbackEscalation + 1, 3),
        lastModified: now,
      };

    case "UPDATE_SETTINGS":
      return {
        ...state,
        settings: { ...state.settings, ...action.payload },
        lastModified: now,
      };

    case "IMPORT_SESSION":
      // Gracefully handle old session formats by providing defaults for missing fields
      const defaultSession = createInitialSession();
      return {
        ...defaultSession, // Start with all default values
        ...action.payload, // Override with imported values
        // Ensure arrays are always arrays (handle missing fields from old formats)
        uploadedFiles: Array.isArray(action.payload.uploadedFiles) ? action.payload.uploadedFiles : [],
        analysisResults: Array.isArray(action.payload.analysisResults) ? action.payload.analysisResults : [],
        literatureFindings: Array.isArray(action.payload.literatureFindings) ? action.payload.literatureFindings : [],
        puzzleArtifacts: Array.isArray(action.payload.puzzleArtifacts) ? action.payload.puzzleArtifacts : [],
        messages: Array.isArray(action.payload.messages) ? action.payload.messages : [],
        // Ensure settings object exists with defaults
        settings: {
          ...defaultSession.settings,
          ...(action.payload.settings || {}),
        },
        // Ensure other required fields have defaults
        currentPhase: action.payload.currentPhase || "opening",
        feedbackEscalation: typeof action.payload.feedbackEscalation === "number" ? action.payload.feedbackEscalation : 0,
        lastModified: now,
      };

    case "RESET_SESSION":
      return createInitialSession();

    default:
      return state;
  }
}

// Context type
interface SessionContextType {
  session: Session;
  initSession: (mode: EntryMode, subfield?: string) => void;
  addMessage: (message: Omit<Message, "id" | "timestamp">) => void;
  addFile: (file: Omit<FileReference, "id" | "uploadedAt">) => void;
  removeFile: (fileId: string) => void;
  addAnalysis: (analysis: Omit<AnalysisResult, "id" | "createdAt">) => void;
  addLiterature: (papers: LiteratureResult[]) => void;
  addArtifact: (artifact: Omit<PuzzleArtifact, "id" | "createdAt">) => void;
  setPhase: (phase: ConversationPhase) => void;
  escalateFeedback: () => void;
  updateSettings: (settings: Partial<SessionSettings>) => void;
  importSession: (session: Session) => void;
  resetSession: () => void;
  exportSession: () => Session;
}

const SessionContext = createContext<SessionContextType | null>(null);

// Provider component
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, dispatch] = useReducer(sessionReducer, null, createInitialSession);

  const initSession = useCallback((mode: EntryMode, subfield?: string) => {
    dispatch({ type: "INIT_SESSION", payload: { mode, subfield } });
  }, []);

  const addMessage = useCallback(
    (message: Omit<Message, "id" | "timestamp">) => {
      const fullMessage: Message = {
        ...message,
        id: generateId(),
        timestamp: getCurrentTimestamp(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: fullMessage });
    },
    []
  );

  const addFile = useCallback(
    (file: Omit<FileReference, "id" | "uploadedAt">) => {
      const fullFile: FileReference = {
        ...file,
        id: generateId(),
        uploadedAt: getCurrentTimestamp(),
      };
      dispatch({ type: "ADD_FILE", payload: fullFile });
    },
    []
  );

  const removeFile = useCallback((fileId: string) => {
    dispatch({ type: "REMOVE_FILE", payload: fileId });
  }, []);

  const addAnalysis = useCallback(
    (analysis: Omit<AnalysisResult, "id" | "createdAt">) => {
      const fullAnalysis: AnalysisResult = {
        ...analysis,
        id: generateId(),
        createdAt: getCurrentTimestamp(),
      };
      dispatch({ type: "ADD_ANALYSIS", payload: fullAnalysis });
    },
    []
  );

  const addLiterature = useCallback((papers: LiteratureResult[]) => {
    dispatch({ type: "ADD_LITERATURE", payload: papers });
  }, []);

  const addArtifact = useCallback(
    (artifact: Omit<PuzzleArtifact, "id" | "createdAt">) => {
      const fullArtifact: PuzzleArtifact = {
        ...artifact,
        id: generateId(),
        createdAt: getCurrentTimestamp(),
      };
      dispatch({ type: "ADD_ARTIFACT", payload: fullArtifact });
    },
    []
  );

  const setPhase = useCallback((phase: ConversationPhase) => {
    dispatch({ type: "SET_PHASE", payload: phase });
  }, []);

  const escalateFeedback = useCallback(() => {
    dispatch({ type: "ESCALATE_FEEDBACK" });
  }, []);

  const updateSettings = useCallback((settings: Partial<SessionSettings>) => {
    dispatch({ type: "UPDATE_SETTINGS", payload: settings });
  }, []);

  const importSession = useCallback((sessionData: Session) => {
    dispatch({ type: "IMPORT_SESSION", payload: sessionData });
  }, []);

  const resetSession = useCallback(() => {
    dispatch({ type: "RESET_SESSION" });
  }, []);

  const exportSession = useCallback(() => {
    return session;
  }, [session]);

  const value: SessionContextType = {
    session,
    initSession,
    addMessage,
    addFile,
    removeFile,
    addAnalysis,
    addLiterature,
    addArtifact,
    setPhase,
    escalateFeedback,
    updateSettings,
    importSession,
    resetSession,
    exportSession,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

// Hook to use session context
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
