export interface User {
  id: string;
  email: string;
  firebaseUid: string;
  createdAt: string;
}

export interface Document {
  document_id: string;
  patient_id: string;
  file_hash: string;
  storage_url: string;
  status: 'UPLOADED' | 'PROCESSING' | 'EXTRACTED' | 'COMPLETED' | 'FAILED';
  created_at: string;
  updated_at: string;
}

export interface ClinicalEvent {
  event_id: string;
  patient_id: string;
  concept_id: string | null;
  event_type: string;
  source_type: string;
  event_time: string;
  verification_status: string;
  concept_display_name?: string | null;
  lab_result?: LabResult | null;
  evidence?: EvidenceLink | null;
}

export interface LabResult {
  event_id: string;
  value: string;
  unit: string;
  reference_range: string;
  abnormal_flag?: string | null;
}

export interface EvidenceLink {
  evidence_id: string;
  event_id: string;
  document_id: string;
  extracted_text: string;
  bounding_box: Record<string, number> | null;
}

export interface TimelineEvent {
  event_id: string;
  level_number: number;
  event_date: string;
  observations: Observation[];
}

export interface Observation {
  observation_id: string;
  structure_id: string;
  finding_code: string;
  finding_display_name: string;
  visual_status: string;
  visual_severity_score: number;
  trend: string;
  clinical_summary: string;
}

export interface BodyStateSnapshot {
  structure_id: string;
  display_name: string;
  mesh_node_name: string;
  visual_status: string;
  severity: number;
  trend: string;
  latest_summary: string | null;
}

export interface BodyStateItem extends BodyStateSnapshot {
  structure_id: string;
  display_name: string;
  mesh_node_name: string;
  visual_status: string;
  severity: number;
  trend: string;
  latest_summary: string | null;
}

export interface AnatomicalStructure {
  structure_id: string;
  display_name: string;
  category: string;
  parent_id: string | null;
  mesh_asset_id: string;
  mesh_node_name: string;
  mesh_version: number;
  is_internal_organ: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  ui_actions?: UIAction[];
}

export interface UIAction {
  action_type: string;
  structure_id: string | null;
  mesh_node_name: string | null;
  visual_status: string | null;
}

export interface ChatResponse {
  conversation_id: string;
  response_text: string;
  ui_actions: UIAction[];
}

export interface DocumentUploadResponse {
  document_id: string;
  patient_id: string;
  file_hash: string;
  storage_url: string;
  status: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ManualLogConcept {
  id: string;
  terminology: string;
  code: string;
  display_name: string;
  short_name: string | null;
}

export interface DailyCheckInRequest {
  log_date: string;
  overall_wellbeing?: number;
  energy_level?: number;
  stress_level?: number;
  sleep?: { duration_minutes: number; sleep_quality?: number; awakenings?: number };
  nutrition?: { water_ml?: number; meals_count?: number; appetite_level?: number };
  notes?: string;
  symptoms: Array<{ concept_id: string; severity: number; duration_minutes?: number; notes?: string }>;
  vitals: Array<{ concept_id: string; value: number; unit: string }>;
  pain: Array<{ severity: number; body_location_id?: string; pain_type?: string }>;
  activities: Array<{ activity_type: string; duration_minutes?: number; calories_burned?: number }>;
  medications: Array<{ medication_name: string; dosage_value?: number; dosage_unit?: string }>;
}

export interface DailyCheckInResponse {
  status: string;
  group_id: string;
  message: string;
}

// ============================================================================
// Document / OCR types
// ============================================================================

export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'EXTRACTED' | 'COMPLETED' | 'FAILED' | 'FAILED_TRIAGE';

export interface DocumentListItem {
  document_id: string;
  patient_id: string;
  file_hash: string;
  storage_url: string;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

export interface DocumentExtraction {
  document_id: string;
  status: DocumentStatus;
  gateway_json: {
    is_medical: boolean;
    document_type: string;
    type_text: string | null;
    bbox: number[] | null;
    image_width: number;
    image_height: number;
  } | null;
  raw_ade_json: Record<string, unknown> | null;
  markdown_text: string | null;
  extraction: {
    document?: {
      document_id?: string;
      document_type?: string;
      title?: string;
      total_pages?: number;
      language?: string;
      source_file?: string;
      patient?: { name?: string; patient_id?: string; date_of_birth?: string; age?: string; sex?: string };
      requester?: { name?: string; role?: string; organisation?: string; department?: string };
      clinical_information?: string;
      sections?: Array<{
        section_id?: string;
        section_type?: string;
        section_title?: string;
        results?: Array<{
          test_name?: string;
          result?: string | number;
          unit?: string;
          reference_range?: string;
          flag?: string;
          source_text?: string;
          confidence?: number;
        }>;
        diagnosis?: string;
        comments?: string;
      }>;
      alerts?: Array<{ message?: string; severity?: string; page_number?: number }>;
    };
  } | null;
  deidentified_markdown: string | null;
}

export interface ProvenanceResponse {
  event_id: string;
  document_id: string;
  storage_url: string;
  extracted_text: string;
  bounding_box: number[] | null;
}

export interface PendingReviewItem {
  event_id: string;
  event_time: string;
  event_type: string;
  extracted_text: string | null;
  document_id: string | null;
  value: string | null;
  unit: string | null;
}

// ============================================================================
// Navigation types
// ============================================================================

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  DocumentUpload: undefined;
  DocumentDetail: { documentId: string };
};

export type MainTabParamList = {
  Dashboard: undefined;
  DailyLog: undefined;
  Body: undefined;
  Timeline: undefined;
  Chat: undefined;
};
