export interface User {
  id: string;
  email: string;
  firebaseUid: string;
  createdAt: string;
}

/** Minimal dial-metric snapshot passed to the Improve window (plain data). */
export interface ImproveMetric {
  id: string;
  label: string;
  valueText: string;
  value: number;
  bandLo: number;
  bandHi: number;
  good: boolean;
  trend: 'up' | 'down' | 'flat';
  avgDays: number;
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
  /**
   * Journal navigation (action_type 'open_timeline_day'). The backend may
   * emit this when the user asks about a dated record ("the day I uploaded
   * my blood report"): the client scrolls the journal to date_key, opens
   * its 2/3 report, and highlights highlight_event_id when present.
   */
  date_key?: string | null;
  highlight_event_id?: string | null;
}

export interface ChatCitation {
  node_id?: string | null;
  observation_id?: string | null;
  event_id?: string | null;
  document_id?: string | null;
  page_number?: number | null;
  quote?: string | null;
  verification_status?: string | null;
  source_type?: string | null;
  evidence_level?: string | null;
}

export interface ChatResponse {
  conversation_id: string;
  response_text: string;
  ui_actions: UIAction[];
  citations?: ChatCitation[];
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
  nutrition?: { water_ml?: number; meals_count?: number; appetite_level?: number; calories_kcal?: number; food_label?: string };
  notes?: string;
  symptoms: Array<{ concept_id: string; severity: number; duration_minutes?: number; notes?: string }>;
  vitals: Array<{ concept_id: string; value: number | null; unit: string | null }>;
  pain: Array<{ severity: number; body_location_id?: string; structure_id?: string; pain_type?: string }>;
  activities: Array<{ activity_type: string; duration_minutes?: number; calories_burned?: number }>;
  medications: Array<{ medication_name: string; dosage_value?: number; dosage_unit?: string }>;
}

export interface DailyCheckInResponse {
  status: string;
  group_id: string;
  message: string;
}

export interface DailyCheckInDetail {
  group_id: string;
  log_date: string;
  overall_wellbeing: number | null;
  energy_level: number | null;
  stress_level: number | null;
  sleep_duration_minutes: number | null;
  sleep_quality: number | null;
  sleep_awakenings: number | null;
  water_ml: number | null;
  meals_count: number | null;
  appetite_level: number | null;
  calories_kcal: number | null;
  food_label: string | null;
  symptoms: Array<{ concept_id: string | null; severity: number; duration_minutes: number | null; notes: string | null }>;
  vitals: Array<{ concept_id: string | null; value: number | null; unit: string | null }>;
  pain: Array<{ body_location_id: string | null; severity: number; pain_type: string | null }>;
  activities: Array<{ activity_type: string; duration_minutes: number | null; calories_burned: number | null }>;
  medications: Array<{ medication_name: string; dosage_value: number | null; dosage_unit: string | null }>;
  notes: string | null;
}

// ============================================================================
// Medication types
// ============================================================================

export type MedicationStatus = 'ACTIVE' | 'SCHEDULED' | 'COMPLETED' | 'PAUSED' | 'DISCONTINUED';
export type MedicationFrequency = 'ONCE_DAILY' | 'TWICE_DAILY' | 'THREE_TIMES_DAILY' | 'FOUR_TIMES_DAILY' | 'EVERY_MORNING' | 'EVERY_EVENING' | 'EVERY_NIGHT' | 'EVERY_8_HOURS' | 'EVERY_12_HOURS' | 'WEEKLY' | 'AS_NEEDED' | 'CUSTOM';
export type MedicationRoute = 'ORAL' | 'TOPICAL' | 'INJECTION' | 'INHALED' | 'SUBLINGUAL' | 'RECTAL' | 'NASAL' | 'OPHTHALMIC' | 'OTHER';
export type DoseTakenStatus = 'TAKEN' | 'MISSED' | 'SKIPPED' | 'LATE';

export interface Medication {
  medication_id: string;
  patient_id: string;
  name: string;
  generic_name: string | null;
  brand_name: string | null;
  strength: string | null;
  strength_unit: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  route: MedicationRoute | null;
  frequency: MedicationFrequency;
  scheduled_times: string[] | null;
  scheduled_weekdays: number[] | null;
  start_date: string | null;
  end_date: string | null;
  status: MedicationStatus;
  purpose: string | null;
  instructions: string | null;
  prescriber: string | null;
  prn: boolean;
  reminder_enabled: boolean;
  notes: string | null;
  source_document_id: string | null;
  supply_quantity: number | null;
  supply_started_on: string | null;
  refills_left: number | null;
  created_at: string;
  updated_at: string;
}

export interface MedicationTakenEvent {
  event_id: string;
  medication_id: string;
  patient_id: string;
  taken_at: string;
  scheduled_for: string | null;
  dose_taken: number | null;
  dose_unit: string | null;
  status: DoseTakenStatus;
  notes: string | null;
  clinical_event_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActiveMedicationForDailyLog {
  medication_id: string;
  name: string;
  strength: string | null;
  strength_unit: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  frequency: MedicationFrequency;
  scheduled_times: string[] | null;
  route: MedicationRoute | null;
  prn: boolean;
}

export interface DailyMedicationSchedule {
  medication: ActiveMedicationForDailyLog;
  scheduled_time: string;
  taken: boolean;
  taken_event_id: string | null;
  taken_at: string | null;
}

export interface PatientProfile {
  display_name: string | null;
  phone_number: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  /** Server mirror of device-owned onboarding preferences (backup only). */
  goals?: string[] | null;
  focus?: string[] | null;
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
  /** On-device cached file path for offline viewing (null until downloaded). */
  local_uri?: string | null;
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
  /** Post-auth personalization (goals → focus → momentum → done), once per patient. */
  OnboardingSetup: undefined;
  /** Post-signup pricing (Free €0 / General €11 / All-in €18), once per new account. */
  Pricing: undefined;
  /** Health-area hub (real-data availability per area). */
  HealthAreas: undefined;
  /** Neutral substance-use tracking (device-only). */
  Substance: undefined;
  /** Explicit cycle tracking (device-only, no predictions). */
  Cycle: undefined;
  /** Sleep goal engine (device check-in data, tracking only). */
  SleepEngine: undefined;
  /** Weight goal engine (profile weight shell, tracking only). */
  WeightEngine: undefined;
  /** Discipline goal engine (tracked-action counts, tracking only). */
  DisciplineEngine: undefined;
  /** Fitness goal engine (logged activity, tracking only). */
  FitnessEngine: undefined;
  /** Nutrition goal engine (logged meals, tracking only). */
  NutritionEngine: undefined;
  /** Wellbeing goal engine (user-entered ratings, tracking only). */
  WellbeingEngine: undefined;
  /** Heart goal engine (camera measurements, tracking only). */
  HeartEngine: undefined;
  /** Overnight-recovery hint from the user's own baseline (device-only). */
  Recovery: undefined;
  /** First-class cross-engine correlation feed (device-only). */
  Insights: undefined;
  /** One-tap doctor report PDF (device-only). */
  Report: undefined;
  /** Priority world (selected engines + shared dial, tracking only). */
  Priority: undefined;
  Main: { screen?: string } | undefined;
  DailyLog: undefined;
  Timeline:
    | { dateKey?: string; highlightEventId?: string }
    | undefined;
  Body: { focusStructureId?: string } | undefined;
  Settings: undefined;
  DocumentUpload: undefined;
  DocumentDetail: { documentId: string };
  /** Past uploads list (device + server documents). */
  Documents: undefined;
  HealthGraph: { focusStructureId?: string; source?: 'body' | 'graph' } | undefined;
  Medications: undefined;
  /** Tappable symptom body map (front/back, male/female, local state). */
  SymptomMap: undefined;
  Improve: { focus: 'improve' | 'keep'; metrics: ImproveMetric[] };
  /* Fingertip + face measurement share one instrument screen (Pulse tab);
     the two legacy routes were removed so only one path can be active. */
  /** Food photo calorie estimation (camera viewfinder + result sheet). */
  FoodScan: undefined;
  /** Guided multipage prescription capture (premium). */
  PrescriptionScanner: undefined;
  /** Confirm-or-tweak review of extracted prescription medicines. */
  PrescriptionReview: { docIds: string[]; sessionId?: string } | undefined;
  /** Call-like local medication reminder (one dose occurrence). */
  MedicationReminder: { occurrenceId: string; action?: 'taken' | 'snooze-30' | 'snooze-60' };
  /** Incoming-call medication reminder (same engine, call UX). */
  MedicationCall: { occurrenceId: string };
  /** Scheduled voice check-in call (setup, ringing, interview, summary). */
  VoiceCheckin: { mode?: 'setup' | 'ringing' } | undefined;
  /** Isolated sanoTTS synthesis test (development only, no call flow). */
  SattsTest: undefined;
  /** Isolated turn-based voice loop (development only, no call flow). */
  VoiceTurn: undefined;
};

// ============================================================================
// Trends types
// ============================================================================

export interface TrendIndicator {
  direction: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  label: string;
}

export interface DailyWellbeingPoint {
  date: string;
  wellbeing: number | null;
  energy: number | null;
  stress: number | null;
}

export interface DailySleepPoint {
  date: string;
  duration_minutes: number | null;
  sleep_quality: number | null;
}

export interface SymptomSummary {
  concept_id: string | null;
  display_name: string;
  count: number;
  avg_severity: number | null;
  latest_date: string;
}

export interface ScatterPoint {
  x: number;
  y: number;
  date: string;
}

export interface CorrelationResult {
  paired_count: number;
  r: number | null;
  strength: string;
  description: string;
}

export interface SymptomTimePoint {
  date: string;
  severity: number;
}

export interface SymptomTimeSeries {
  concept_id: string | null;
  display_name: string;
  points: SymptomTimePoint[];
}

export interface MedicalRecordActivityPoint {
  date: string;
  event_count: number;
}

export interface Insight {
  text: string;
}

export interface TrendsResponse {
  period_days: number;
  logged_days: number;
  wellbeing_points: DailyWellbeingPoint[];
  avg_wellbeing: number | null;
  avg_energy: number | null;
  avg_stress: number | null;
  wellbeing_trend: TrendIndicator;
  sleep_points: DailySleepPoint[];
  avg_sleep_minutes: number | null;
  min_sleep_minutes: number | null;
  max_sleep_minutes: number | null;
  avg_sleep_quality: number | null;
  sleep_trend: TrendIndicator;
  sleep_energy_scatter: ScatterPoint[];
  sleep_energy_correlation: CorrelationResult;
  sleep_stress_scatter: ScatterPoint[];
  sleep_stress_correlation: CorrelationResult;
  symptom_summaries: SymptomSummary[];
  symptom_time_series: SymptomTimeSeries[];
  available_symptoms: string[];
  documents_processed: number;
  clinical_events_extracted: number;
  medical_record_activity: MedicalRecordActivityPoint[];
  insights: Insight[];
}

export type MainTabParamList = {
  Dashboard: undefined;
  PpgMeasure: undefined;
  Chat: undefined;
};

export type BodyStackParamList = {
  BodyView: undefined;
  HealthGraph: undefined;
};
