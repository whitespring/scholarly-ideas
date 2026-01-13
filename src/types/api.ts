/**
 * API request and response types
 */

import type {
  AnalysisResult,
  LiteratureResult,
  Message,
  PuzzleArtifact,
  PuzzleArtifactType,
  SessionSettings,
} from './session';

// Chat API
export interface ChatRequest {
  messages: Message[];
  settings: SessionSettings;
  currentPhase: string;
  subfield?: string;
  analysisContext?: AnalysisResult[];
  literatureContext?: LiteratureResult[];
}

export interface ChatResponse {
  message: Message;
  suggestedActions?: string[];
  phaseTransition?: string;
  feedbackLevel?: string;
}

// File Upload API
export interface UploadRequest {
  file: File;
}

export interface UploadResponse {
  fileId: string;
  fileName: string;
  fileType: string;
  size: number;
  summary: string;
  variables?: VariableSummary[];
  themes?: ThemeSummary[];
}

export interface VariableSummary {
  name: string;
  type: 'numeric' | 'categorical' | 'text' | 'date';
  count: number;
  missing: number;
  stats?: NumericStats;
  categories?: CategoryCount[];
}

export interface NumericStats {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
}

export interface CategoryCount {
  value: string;
  count: number;
}

export interface ThemeSummary {
  theme: string;
  frequency: number;
  examples: string[];
}

// Analysis API
export interface AnalyzeRequest {
  fileId: string;
  analysisType: string;
  options?: Record<string, unknown>;
}

export interface AnalyzeResponse {
  result: AnalysisResult;
}

// Literature API
export interface LiteratureRequest {
  query: string;
  subfield?: string;
  limit?: number;
}

// Search metadata describing what strategies were used
export interface SearchMetadata {
  tier: 1 | 2 | 3;  // Which abstraction tier succeeded (1=narrow, 2=context-abstract, 3=foundational)
  exactMatchFound: boolean;
  usedSynonyms: boolean;
  usedBroadening: boolean;
  relaxedCitations: boolean;
  includedNonQualityJournals: boolean;  // Always false in 3-tier system
  searchTermsUsed: string[];
  message?: string;  // User-facing explanation of search results
}

export interface LiteratureResponse {
  papers: LiteratureResult[];         // All papers (backwards compat)
  classics: LiteratureResult[];       // Foundational works (>5yr, >=500 cites)
  recent: LiteratureResult[];         // Recent contributions (<=5yr)
  totalFound: number;
  cached: boolean;
  analysis?: string; // Claude's analysis of research puzzles from the literature
  searchMetadata?: SearchMetadata; // Metadata about search strategy used
}

// Generate Output API
export interface GenerateRequest {
  type: PuzzleArtifactType;
  sessionContext: {
    messages: Message[];
    analysisResults?: AnalysisResult[];
    literatureFindings?: LiteratureResult[];
    subfield?: string;
  };
}

export interface GenerateResponse {
  artifact: PuzzleArtifact;
}

// Export API
export interface ExportRequest {
  format: 'json' | 'pdf';
  includeConversation: boolean;
  includeOutputsOnly: boolean;
}

export interface ExportResponse {
  data: string | Blob;
  filename: string;
  contentType: string;
}

// Import API
export interface ImportRequest {
  sessionData: string;
}

export interface ImportResponse {
  success: boolean;
  welcomeBackSummary: string;
  session: import('./session').Session;
}

// Error Response
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}
