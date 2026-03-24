import { z } from "zod";

// --- COMMUNICATION CHANNELS ---
export const COMMUNICATION_CHANNELS = [
  { value: "voice", label: "Voice Call", description: "Audio call recording (transcribed by AssemblyAI)" },
  { value: "email", label: "Email", description: "Email message (text analyzed directly, no transcription cost)" },
  { value: "chat", label: "Chat", description: "Live chat or messaging conversation" },
  { value: "sms", label: "SMS", description: "Text message conversation" },
] as const;

export type CommunicationChannel = typeof COMMUNICATION_CHANNELS[number]["value"];

// --- CALL CATEGORY ---
export const CALL_CATEGORIES = [
  { value: "inbound", label: "Inbound Call", description: "Customer/patient calling into the company" },
  { value: "outbound", label: "Outbound Call", description: "Employee calling a customer/patient" },
  { value: "internal", label: "Internal", description: "Call between coworkers or departments" },
  { value: "vendor", label: "Vendor/Partner", description: "Call with an external vendor or partner" },
  { value: "clinical_encounter", label: "Clinical Encounter", description: "Doctor-patient clinical visit recording" },
  { value: "telemedicine", label: "Telemedicine Visit", description: "Remote telehealth consultation" },
  // Dental practice categories
  { value: "dental_scheduling", label: "Dental Scheduling", description: "Appointment scheduling, rescheduling, or cancellation call" },
  { value: "dental_insurance", label: "Dental Insurance", description: "Insurance verification, benefits explanation, or pre-authorization" },
  { value: "dental_treatment", label: "Dental Treatment Discussion", description: "Treatment plan discussion, acceptance, or financial arrangements" },
  { value: "dental_recall", label: "Dental Recall/Recare", description: "Recall or recare reminder call, hygiene appointment booking" },
  { value: "dental_emergency", label: "Dental Emergency Triage", description: "Emergency triage call — toothache, trauma, swelling" },
  { value: "dental_encounter", label: "Dental Clinical Encounter", description: "In-office dental visit or procedure recording" },
  { value: "dental_consultation", label: "Dental Consultation", description: "New patient consultation or second opinion" },
  // Email categories
  { value: "email_support", label: "Support Email", description: "Customer support or help request email" },
  { value: "email_billing", label: "Billing Email", description: "Billing inquiry, payment, or invoice-related email" },
  { value: "email_complaint", label: "Complaint Email", description: "Customer complaint or escalation email" },
  { value: "email_appointment", label: "Appointment Email", description: "Appointment request, confirmation, or scheduling email" },
  { value: "email_insurance", label: "Insurance Email", description: "Insurance inquiry, authorization, or claims email" },
  { value: "email_referral", label: "Referral Email", description: "Patient or customer referral communication" },
  { value: "email_followup", label: "Follow-up Email", description: "Post-service or post-appointment follow-up" },
  { value: "email_general", label: "General Email", description: "General inquiry or miscellaneous email" },
] as const;

// --- CLINICAL NOTE SCHEMAS ---
export const CLINICAL_SPECIALTIES = [
  { value: "primary_care", label: "Primary Care / Family Medicine" },
  { value: "internal_medicine", label: "Internal Medicine" },
  { value: "cardiology", label: "Cardiology" },
  { value: "dermatology", label: "Dermatology" },
  { value: "orthopedics", label: "Orthopedics" },
  { value: "psychiatry", label: "Psychiatry / Behavioral Health" },
  { value: "pediatrics", label: "Pediatrics" },
  { value: "ob_gyn", label: "OB/GYN" },
  { value: "emergency", label: "Emergency Medicine" },
  { value: "urgent_care", label: "Urgent Care" },
  { value: "general", label: "General / Other" },
  // Dental specialties
  { value: "general_dentistry", label: "General Dentistry" },
  { value: "periodontics", label: "Periodontics" },
  { value: "endodontics", label: "Endodontics" },
  { value: "oral_surgery", label: "Oral & Maxillofacial Surgery" },
  { value: "orthodontics", label: "Orthodontics" },
  { value: "prosthodontics", label: "Prosthodontics" },
  { value: "pediatric_dentistry", label: "Pediatric Dentistry" },
] as const;

export const CLINICAL_NOTE_FORMATS = [
  { value: "soap", label: "SOAP Note", description: "Subjective, Objective, Assessment, Plan" },
  { value: "hpi_focused", label: "HPI-Focused", description: "Detailed History of Present Illness narrative" },
  { value: "procedure_note", label: "Procedure Note", description: "Procedural documentation" },
  { value: "progress_note", label: "Progress Note", description: "Follow-up visit documentation" },
  // Behavioral health note formats
  { value: "dap", label: "DAP Note", description: "Data, Assessment, Plan — common for therapy/counseling" },
  { value: "birp", label: "BIRP Note", description: "Behavior, Intervention, Response, Plan — behavioral health" },
  // Dental note formats
  { value: "dental_exam", label: "Dental Examination", description: "Comprehensive or periodic oral examination" },
  { value: "dental_operative", label: "Operative Note", description: "Restorative/operative procedure documentation" },
  { value: "dental_perio", label: "Periodontal Note", description: "Periodontal examination and treatment" },
  { value: "dental_endo", label: "Endodontic Note", description: "Root canal or endodontic procedure" },
  { value: "dental_ortho_progress", label: "Ortho Progress Note", description: "Orthodontic adjustment/progress visit" },
  { value: "dental_surgery", label: "Oral Surgery Note", description: "Extraction or oral surgery documentation" },
  { value: "dental_treatment_plan", label: "Treatment Plan", description: "Comprehensive treatment plan documentation" },
] as const;

export const clinicalNoteSchema = z.object({
  format: z.string().default("soap"),
  specialty: z.string().optional(),
  chiefComplaint: z.string().optional(),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.array(z.string()).optional(),
  hpiNarrative: z.string().optional(),
  reviewOfSystems: z.record(z.string()).optional(),
  differentialDiagnoses: z.array(z.string()).optional(),
  icd10Codes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  cptCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  prescriptions: z.array(z.object({
    medication: z.string(),
    dosage: z.string().optional(),
    instructions: z.string().optional(),
  })).optional(),
  followUp: z.string().optional(),
  documentationCompleteness: z.number().min(0).max(10).optional(),
  clinicalAccuracy: z.number().min(0).max(10).optional(),
  missingSections: z.array(z.string()).optional(),
  patientConsentObtained: z.boolean().optional(),
  providerAttested: z.boolean().default(false),
  // Optimistic locking for concurrent edit detection
  version: z.number().optional(),
  // Attestation & audit metadata (HIPAA-required)
  attestedBy: z.string().optional(),
  attestedById: z.string().optional(),
  attestedNpi: z.string().optional(),
  attestedAt: z.string().optional(),
  consentRecordedBy: z.string().optional(),
  consentRecordedAt: z.string().optional(),
  editHistory: z.array(z.object({
    editedBy: z.string(),
    editedAt: z.string(),
    fieldsChanged: z.array(z.string()),
  })).optional(),
  // Behavioral health (DAP/BIRP) fields
  data: z.string().optional(), // DAP: combined subjective/objective data
  behavior: z.string().optional(), // BIRP: observable client behaviors
  intervention: z.string().optional(), // BIRP: therapeutic interventions applied
  response: z.string().optional(), // BIRP: client's response to interventions
  // Validation warnings from server-side code/format validation
  validationWarnings: z.array(z.string()).optional(),
  // Quality feedback from reviewers (manager/admin rating the AI-generated note)
  qualityFeedback: z.array(z.object({
    rating: z.number().min(1).max(5),
    comment: z.string().optional(),
    improvementAreas: z.array(z.string()).optional(),
    ratedBy: z.string().optional(),
    ratedById: z.string().optional(),
    ratedAt: z.string(),
  })).optional(),
  // Dental-specific fields
  cdtCodes: z.array(z.object({ code: z.string(), description: z.string() })).optional(),
  toothNumbers: z.array(z.string()).optional(),
  quadrants: z.array(z.string()).optional(),
  periodontalFindings: z.record(z.string()).optional(),
  treatmentPhases: z.array(z.object({
    phase: z.number(),
    description: z.string(),
    procedures: z.array(z.string()),
    estimatedCost: z.string().optional(),
  })).optional(),
});

export type ClinicalNote = z.infer<typeof clinicalNoteSchema>;

export type CallCategory = typeof CALL_CATEGORIES[number]["value"];

// --- CALL SCHEMAS ---
// "Call" is the universal interaction entity — supports voice calls, emails, chat, and SMS.
// Channel defaults to "voice" for backward compatibility. Email/chat/SMS skip transcription.
export const insertCallSchema = z.object({
  orgId: z.string(),
  employeeId: z.string().optional(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  fileHash: z.string().optional(),
  status: z.enum(["pending", "processing", "completed", "failed"]).default("pending"),
  duration: z.number().optional(),
  assemblyAiId: z.string().optional(),
  callCategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // Multi-channel support (defaults to "voice" in storage layer for backward compatibility)
  channel: z.enum(["voice", "email", "chat", "sms"]).optional(),
  // Email-specific fields (populated when channel="email")
  emailSubject: z.string().optional(),
  emailFrom: z.string().optional(),
  emailTo: z.string().optional(),
  emailCc: z.string().optional(),
  emailBody: z.string().optional(),      // plain text body
  emailBodyHtml: z.string().optional(),  // HTML body (for display)
  emailMessageId: z.string().optional(), // external message ID (Gmail, Outlook, etc.)
  emailThreadId: z.string().optional(),  // thread/conversation grouping
  emailReceivedAt: z.string().optional(),
  // Chat/SMS fields (for future use)
  chatPlatform: z.string().optional(),   // "intercom", "zendesk", "twilio", etc.
  messageCount: z.number().optional(),   // number of messages in conversation
});

export const callSchema = insertCallSchema.extend({
  id: z.string(),
  orgId: z.string(),
  uploadedAt: z.string().optional(),
});

// --- TRANSCRIPT SCHEMAS ---
export const transcriptWordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
  speaker: z.string().optional(),
});

export const transcriptCorrectionSchema = z.object({
  wordIndex: z.number(),       // index into words array
  original: z.string(),
  corrected: z.string(),
  correctedBy: z.string(),     // user name
  correctedAt: z.string(),     // ISO timestamp
});

export const insertTranscriptSchema = z.object({
  orgId: z.string(),
  callId: z.string(),
  text: z.string().optional(),
  confidence: z.string().optional(),
  words: z.array(transcriptWordSchema).optional(),
  corrections: z.array(transcriptCorrectionSchema).optional(),
  correctedText: z.string().optional(), // full corrected text (built from applying corrections)
});

export const transcriptSchema = insertTranscriptSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- SENTIMENT ANALYSIS SCHEMAS ---
export const sentimentSegmentSchema = z.object({
  text: z.string(),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]),
  confidence: z.number(),
  start: z.number(),
  end: z.number(),
});

export const insertSentimentAnalysisSchema = z.object({
  orgId: z.string(),
  callId: z.string(),
  overallSentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  overallScore: z.string().optional(),
  segments: z.array(sentimentSegmentSchema).optional(),
});

export const sentimentAnalysisSchema = insertSentimentAnalysisSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- CALL ANALYSIS SCHEMAS ---
export const analysisFeedbackSchema = z.object({
  strengths: z.array(z.union([z.string(), z.object({ text: z.string(), timestamp: z.string().optional() })])).optional(),
  suggestions: z.array(z.union([z.string(), z.object({ text: z.string(), timestamp: z.string().optional() })])).optional(),
});

export const manualEditSchema = z.object({
  editedBy: z.string(),
  editedAt: z.string(),
  reason: z.string(),
  fieldsChanged: z.array(z.string()),
  previousValues: z.record(z.unknown()),
});

export const confidenceFactorsSchema = z.object({
  transcriptConfidence: z.number(),
  wordCount: z.number(),
  callDurationSeconds: z.number(),
  transcriptLength: z.number(),
  aiAnalysisCompleted: z.boolean(),
  overallScore: z.number(),
});

// Speech analytics computed from word timing data
export const speechMetricsSchema = z.object({
  talkSpeedWpm: z.number().optional(),             // Words per minute
  deadAirSeconds: z.number().optional(),            // Total silence > 3s
  deadAirCount: z.number().optional(),              // Number of silence gaps > 3s
  longestDeadAirSeconds: z.number().optional(),     // Longest single silence
  interruptionCount: z.number().optional(),         // Times speakers overlapped
  fillerWordCount: z.number().optional(),           // "um", "uh", "like", "you know" etc.
  fillerWords: z.record(z.number()).optional(),      // Breakdown by filler word
  avgResponseTimeMs: z.number().optional(),         // Avg time between speaker turns
  talkListenRatio: z.number().optional(),           // Agent talk / total talk ratio
  speakerATalkPercent: z.number().optional(),       // Speaker A % of total talk time
  speakerBTalkPercent: z.number().optional(),       // Speaker B % of total talk time
});

export const insertCallAnalysisSchema = z.object({
  orgId: z.string(),
  callId: z.string(),
  performanceScore: z.string().optional(),
  talkTimeRatio: z.string().optional(),
  responseTime: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  summary: z.string().optional(),
  actionItems: z.array(z.string()).optional(),
  feedback: analysisFeedbackSchema.optional(),
  lemurResponse: z.unknown().optional(),
  callPartyType: z.string().optional(),
  flags: z.array(z.string()).optional(),
  manualEdits: z.array(manualEditSchema).optional(),
  confidenceScore: z.string().optional(),
  confidenceFactors: confidenceFactorsSchema.optional(),
  subScores: z.object({
    compliance: z.number().min(0).max(10).optional(),
    customerExperience: z.number().min(0).max(10).optional(),
    communication: z.number().min(0).max(10).optional(),
    resolution: z.number().min(0).max(10).optional(),
  }).optional(),
  detectedAgentName: z.string().optional(),
  // Score rationale: 3-5 bullet points per dimension explaining the score
  scoreRationale: z.record(z.array(z.string())).optional(),
  // Prompt versioning: hash of the system prompt used to generate this analysis
  promptVersionId: z.string().optional(),
  clinicalNote: clinicalNoteSchema.optional(),
  speechMetrics: speechMetricsSchema.optional(),
  // Self-review: agent can review their own call
  selfReview: z.object({
    score: z.number().min(0).max(10).optional(),
    notes: z.string().optional(),
    reviewedAt: z.string().optional(),
    reviewedBy: z.string().optional(),
  }).optional(),
  // Score dispute: agent can dispute the QA score
  scoreDispute: z.object({
    status: z.enum(["open", "under_review", "accepted", "rejected"]),
    reason: z.string(),
    disputedBy: z.string(),
    disputedAt: z.string(),
    resolvedBy: z.string().optional(),
    resolvedAt: z.string().optional(),
    resolution: z.string().optional(),
    originalScore: z.number().optional(),
    adjustedScore: z.number().optional(),
  }).optional(),
  // Patient-facing visit summary (plain language)
  patientSummary: z.string().optional(),
  // AI-generated referral letter
  referralLetter: z.string().optional(),
  // Auto-suggested billing codes from transcript
  suggestedBillingCodes: z.object({
    cptCodes: z.array(z.object({ code: z.string(), description: z.string(), confidence: z.number() })).optional(),
    icd10Codes: z.array(z.object({ code: z.string(), description: z.string(), confidence: z.number() })).optional(),
    cdtCodes: z.array(z.object({ code: z.string(), description: z.string(), confidence: z.number() })).optional(),
  }).optional(),
  // Speaker role mapping — which speaker label (A/B) is the agent
  speakerRoleMap: z.object({ agentSpeaker: z.string() }).optional(),
  // Detected language from AssemblyAI language detection (ISO code, e.g., "en", "es")
  detectedLanguage: z.string().optional(),
});

export const callAnalysisSchema = insertCallAnalysisSchema.extend({
  id: z.string(),
  orgId: z.string(),
  createdAt: z.string().optional(),
});

// --- TYPES ---
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = z.infer<typeof callSchema>;

export type InsertTranscript = z.infer<typeof insertTranscriptSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;

export type InsertSentimentAnalysis = z.infer<typeof insertSentimentAnalysisSchema>;
export type SentimentAnalysis = z.infer<typeof sentimentAnalysisSchema>;

export type InsertCallAnalysis = z.infer<typeof insertCallAnalysisSchema>;
export type CallAnalysis = z.infer<typeof callAnalysisSchema>;
