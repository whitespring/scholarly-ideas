/**
 * Core types for the Scholarly Ideas application
 * Based on the data model specification
 */

export type EntryMode = 'idea' | 'data' | 'exploring';

export type MessageRole = 'user' | 'assistant' | 'system';

export type ConversationPhase =
  | 'opening'
  | 'probing'
  | 'literature'
  | 'diagnosis'
  | 'articulation'
  | 'output';

export type FeedbackLevel = 'gentle' | 'moderate' | 'direct';

export type PuzzleArtifactType = 'statement' | 'introduction' | 'brief';

export type AnalysisType =
  | 'descriptive'
  | 'correlation'
  | 'anomaly'
  | 'subgroup'
  | 'theme'
  | 'quotes';

export interface MessageMetadata {
  analysisTriggered?: boolean;
  literatureQueried?: boolean;
  feedbackLevel?: FeedbackLevel;
  phase?: ConversationPhase;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  metadata?: MessageMetadata;
}

export interface FileReference {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  summary?: string;
}

export interface RigorWarning {
  type: 'multiple_testing' | 'data_dredging' | 'sample_size' | 'selection_bias';
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface AnalysisResult {
  id: string;
  type: AnalysisType;
  summary: string;
  details: Record<string, unknown>;
  rigorWarnings: RigorWarning[];
  createdAt: string;
}

export interface LiteratureResult {
  id: string;
  paperId: string;
  title: string;
  authors: string[];
  year: number;
  abstract?: string;
  url?: string;
  citationCount?: number;
  isCrossDisciplinary: boolean;
  discipline?: string;
  relevanceScore?: number;
}

export interface PuzzleArtifact {
  id: string;
  type: PuzzleArtifactType;
  content: string;
  version: number;
  createdAt: string;
}

export interface SessionSettings {
  beDirectMode: boolean;
  teachMeMode: boolean;
}

export interface Session {
  id: string;
  mode: EntryMode;
  subfield?: string;
  messages: Message[];
  uploadedFiles: FileReference[];
  analysisResults: AnalysisResult[];
  literatureFindings: LiteratureResult[];
  puzzleArtifacts: PuzzleArtifact[];
  settings: SessionSettings;
  currentPhase: ConversationPhase;
  feedbackEscalation: number; // 0-3 tracking escalation level
  createdAt: string;
  lastModified: string;
}

export interface SessionExport {
  version: string;
  exportedAt: string;
  session: Session;
}

// Subfield options for Management research
export const SUBFIELDS = [
  'Strategy',
  'Organizational Behavior',
  'Entrepreneurship',
  'International Business',
  'Organization Theory',
  'Human Resources',
  'Operations Management',
  'Technology & Innovation',
  'Other',
] as const;

export type Subfield = typeof SUBFIELDS[number];
