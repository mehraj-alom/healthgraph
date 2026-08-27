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