import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, csrfFetch } from "@/lib/queryClient";
import type { ClinicalNote } from "@shared/schema";
import {
  RiStethoscopeLine,
  RiShieldCheckLine,
  RiAlertLine,
  RiFileTextLine,
  RiCalendarLine,
  RiPencilLine,
  RiSaveLine,
  RiCloseLine,
  RiPulseLine,
  RiMessage2Line,
  RiInformationLine,
  RiFileCopyLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiRefreshLine,
  RiCheckDoubleLine,
  RiCapsuleLine,
  RiListCheck2,
  RiPrinterLine,
  RiInputMethodLine,
  RiHistoryLine,
} from "@remixicon/react";

interface QualityFeedbackEntry {
  rating: number;
  comment?: string;
  improvementAreas?: string[];
  ratedBy?: string;
  ratedAt?: string;
}

interface CallWithClinical {
  id: string;
  fileName?: string;
  status: string;
  duration?: number;
  callCategory?: string;
  uploadedAt?: string;
  analysis?: {
    summary?: string;
    clinicalNote?: ClinicalNote & {
      attestedBy?: string;
      attestedAt?: string;
      consentRecordedBy?: string;
      consentRecordedAt?: string;
      editHistory?: Array<{ editedBy: string; editedAt: string; fieldsChanged: string[] }>;
      validationWarnings?: string[];
      weightedCompleteness?: number;
      sectionDepth?: Record<string, "empty" | "minimal" | "adequate" | "thorough">;
      qualityFeedback?: QualityFeedbackEntry[];
    };
  };
  employee?: { name: string };
}

// --- Editable Section Card ---
// SectionCard extracted to @/components/lib/section-card for reuse across pages
import { SectionCard } from "@/components/lib/section-card";

// --- Format label helper ---
function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    soap: "SOAP",
    dap: "DAP",
    birp: "BIRP",
    hpi_focused: "HPI-Focused",
    procedure_note: "Procedure Note",
    progress_note: "Progress Note",
    dental_exam: "Dental Exam",
    dental_operative: "Dental Operative",
    dental_perio: "Periodontal",
    dental_endo: "Endodontic",
    dental_ortho_progress: "Ortho Progress",
    dental_surgery: "Oral Surgery",
    dental_treatment_plan: "Treatment Plan",
  };
  return labels[format] || format.toUpperCase();
}

export default function ClinicalNotesPage() {
  const [, params] = useRoute("/clinical/notes/:id");
  const callId = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, unknown>>({});
  const printRef = useRef<HTMLDivElement>(null);

  const { data: call, isLoading } = useQuery<CallWithClinical>({
    queryKey: ["/api/calls", callId],
    enabled: !!callId,
  });

  const attestMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(`/api/clinical/notes/${callId}/attest`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to attest");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Note attested", description: "Clinical note has been marked as provider-reviewed." });
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
    onError: () => {
      toast({ title: "Attestation failed", variant: "destructive" });
    },
  });

  const consentMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(`/api/clinical/notes/${callId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ consentObtained: true }),
      });
      if (!res.ok) throw new Error("Failed to record consent");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Consent recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Include version for optimistic locking — prevents concurrent edit data loss.
      // The server requires version on ALL edits (not just attested notes).
      await apiRequest("PATCH", `/api/clinical/notes/${callId}`, {
        ...editFields,
        version: cn?.version ?? 0,
      });
    },
    onSuccess: () => {
      toast({ title: "Note updated", description: "Clinical note saved. Re-attestation required." });
      setEditing(false);
      setEditFields({});
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
    onError: (err: any) => {
      const isConflict = err.message?.includes("modified by another user") || err.status === 409;
      if (isConflict) {
        toast({
          title: "Edit conflict",
          description: "This note was modified by another user. Refreshing to get latest version.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
        setEditing(false);
        setEditFields({});
      } else {
        toast({ title: "Save failed", description: err.message, variant: "destructive" });
      }
    },
  });

  // --- Quality feedback state ---
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState("");

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      const res = await csrfFetch(`/api/clinical/notes/${callId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rating: feedbackRating, comment: feedbackComment || undefined }),
      });
      if (!res.ok) throw new Error("Failed to submit feedback");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Feedback submitted", description: "Thank you for rating the AI note quality." });
      setShowFeedback(false);
      setFeedbackRating(0);
      setFeedbackComment("");
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
    },
  });

  // Derive clinical note reference early so closures below can use it safely.
  // This replaces the late definition at line 313 (which was after early returns).
  const cn = call?.analysis?.clinicalNote;

  // --- Transcript editing state ---
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [showReanalyzeConfirm, setShowReanalyzeConfirm] = useState(false);

  const { data: transcript } = useQuery<{ text?: string; callId: string }>({
    queryKey: ["/api/calls", callId, "transcript"],
    queryFn: async () => {
      const res = await fetch(`/api/calls/${callId}/transcript`, { credentials: "include" });
      if (!res.ok) return { callId: callId || "", text: "" };
      return res.json();
    },
    enabled: !!callId,
  });

  const startEditingTranscript = () => {
    setTranscriptText(transcript?.text || "");
    setEditingTranscript(true);
  };

  const saveTranscriptMutation = useMutation({
    mutationFn: async ({ reanalyze }: { reanalyze: boolean }) => {
      const res = await apiRequest("PATCH", `/api/clinical/transcript/${callId}`, {
        text: transcriptText,
        reanalyze,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setEditingTranscript(false);
      setShowReanalyzeConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId] });
      queryClient.invalidateQueries({ queryKey: ["/api/calls", callId, "transcript"] });
      if (data.reanalysis?.success) {
        toast({
          title: "Transcript saved & note regenerated",
          description: "The clinical note has been updated from the edited transcript. Re-attestation required.",
        });
      } else if (data.reanalysis && !data.reanalysis.success) {
        toast({ title: "Transcript saved", description: data.reanalysis.message, variant: "destructive" });
      } else {
        toast({ title: "Transcript saved", description: "Transcript updated. The clinical note was not changed." });
      }
    },
    onError: (err) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const startEditing = () => {
    if (!cn) return;
    setEditFields({
      chiefComplaint: cn.chiefComplaint || "",
      subjective: cn.subjective || "",
      objective: cn.objective || "",
      assessment: cn.assessment || "",
      plan: cn.plan || [],
      hpiNarrative: cn.hpiNarrative || "",
      followUp: cn.followUp || "",
      // DAP/BIRP fields
      data: cn.data || "",
      behavior: cn.behavior || "",
      intervention: cn.intervention || "",
      response: cn.response || "",
      // Dental fields
      toothNumbers: cn.toothNumbers || [],
      quadrants: cn.quadrants || [],
    });
    setEditing(true);
  };

  const handleToothNumbersChange = (value: string) => {
    setEditFields((prev) => ({
      ...prev,
      toothNumbers: value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
  };

  const handleQuadrantsChange = (value: string) => {
    setEditFields((prev) => ({
      ...prev,
      quadrants: value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Copied", description: text });
    });
  };

  const handleFieldChange = (field: string, value: string) => {
    setEditFields((prev) => ({ ...prev, [field]: value }));
  };

  const handlePlanChange = (value: string) => {
    setEditFields((prev) => ({ ...prev, plan: value.split("\n").filter(Boolean) }));
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    // Sanitize title to prevent injection via employee name
    const safeTitle = (call?.employee?.name || "Patient").replace(/[<>&"']/g, "");
    const doc = printWindow.document;
    doc.open();
    doc.write(`<html><head><title>Clinical Note — ${safeTitle}</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; font-size: 14px; }
        h1 { font-size: 20px; border-bottom: 2px solid #333; padding-bottom: 8px; }
        h2 { font-size: 16px; margin-top: 20px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
        .draft { background: #fff3cd; border: 1px solid #ffc107; padding: 8px 12px; border-radius: 4px; margin: 10px 0; font-weight: bold; }
        .codes { display: flex; gap: 8px; flex-wrap: wrap; }
        .code { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 12px; }
        ul { padding-left: 20px; }
        p { line-height: 1.6; }
        @media print { .no-print { display: none; } }
      </style></head><body></body></html>`);
    // Use deep clone instead of innerHTML to prevent XSS from note content
    const cloned = printContent.cloneNode(true) as HTMLElement;
    doc.body.appendChild(cloned);
    const printScript = doc.createElement("script");
    printScript.textContent = "window.print(); window.close();";
    doc.body.appendChild(printScript);
    doc.close();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RiStethoscopeLine className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!call) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Encounter not found.</p>
      </div>
    );
  }

  if (!cn) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center">
            <RiStethoscopeLine className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Clinical note not yet generated</h2>
            <p className="text-muted-foreground mt-2">
              {call.status === "processing"
                ? "The encounter is still being processed..."
                : "No clinical note was generated for this encounter."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isDap = cn.format === "dap";
  const isBirp = cn.format === "birp";
  const isDental = cn.format?.startsWith("dental_");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <RiStethoscopeLine className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">Clinical Note</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {call.employee?.name && <span className="font-medium">{call.employee.name}</span>}
            {call.uploadedAt && <span> — {new Date(call.uploadedAt).toLocaleDateString()}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {cn.providerAttested ? (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              <RiCheckDoubleLine className="w-3.5 h-3.5 mr-1" />
              Attested
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              <RiAlertLine className="w-3.5 h-3.5 mr-1" />
              Draft
            </Badge>
          )}
          {cn.patientConsentObtained && (
            <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
              <RiShieldCheckLine className="w-3.5 h-3.5 mr-1" />
              Consent
            </Badge>
          )}
          {/* Action buttons */}
          {editing ? (
            <>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <RiSaveLine className="w-4 h-4 mr-1" />
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setEditFields({});
                }}
              >
                <RiCloseLine className="w-4 h-4 mr-1" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={startEditing}>
                <RiPencilLine className="w-4 h-4 mr-1" />
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={handlePrint}>
                <RiPrinterLine className="w-4 h-4 mr-1" />
                Print / Export
              </Button>
            </>
          )}
        </div>
      </div>

      {/* AI Draft Warning */}
      {!cn.providerAttested && !editing && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-3">
              <RiAlertLine className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">AI-Generated Draft</p>
                <p className="text-amber-700 dark:text-amber-300 mt-1">
                  This clinical note was automatically generated from the encounter recording. Review for accuracy, edit
                  if needed, then attest before use.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" onClick={() => attestMutation.mutate()} disabled={attestMutation.isPending}>
                    <RiCheckDoubleLine className="w-4 h-4 mr-1" />
                    Attest Note
                  </Button>
                  {!cn.patientConsentObtained && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => consentMutation.mutate()}
                      disabled={consentMutation.isPending}
                    >
                      <RiShieldCheckLine className="w-4 h-4 mr-1" />
                      Record Consent
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transcript Section — collapsible, editable */}
      {transcript?.text && (
        <Card className="print:hidden">
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setTranscriptExpanded(!transcriptExpanded)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <RiInputMethodLine className="w-4 h-4 text-muted-foreground" />
                Encounter Transcript
                <Badge variant="outline" className="text-xs font-normal ml-2">
                  {transcript.text.length.toLocaleString()} chars
                </Badge>
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                {transcriptExpanded ? <RiArrowUpSLine className="w-4 h-4" /> : <RiArrowDownSLine className="w-4 h-4" />}
              </Button>
            </div>
          </CardHeader>
          {transcriptExpanded && (
            <CardContent className="space-y-3">
              {editingTranscript ? (
                <>
                  <Textarea
                    value={transcriptText}
                    onChange={(e) => setTranscriptText(e.target.value)}
                    className="min-h-[200px] text-sm font-mono"
                    placeholder="Transcript text..."
                  />
                  <div className="flex items-center gap-2">
                    {showReanalyzeConfirm ? (
                      <div className="flex-1 flex items-start gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
                        <RiRefreshLine className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                        <div className="flex-1 text-sm">
                          <p className="font-medium text-blue-800 dark:text-blue-200">Re-run AI analysis?</p>
                          <p className="text-blue-700 dark:text-blue-300 mt-1">
                            This will regenerate the clinical note from the edited transcript using AI. The existing
                            note will be replaced and will need re-attestation. A small amount of AI usage will be
                            consumed (~$0.02).
                          </p>
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              onClick={() => saveTranscriptMutation.mutate({ reanalyze: true })}
                              disabled={saveTranscriptMutation.isPending}
                            >
                              <RiRefreshLine className="w-3.5 h-3.5 mr-1" />
                              {saveTranscriptMutation.isPending ? "Saving & analyzing..." : "Save & Re-analyze"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => saveTranscriptMutation.mutate({ reanalyze: false })}
                              disabled={saveTranscriptMutation.isPending}
                            >
                              Save without re-analysis
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setShowReanalyzeConfirm(false)}
                              disabled={saveTranscriptMutation.isPending}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => setShowReanalyzeConfirm(true)}
                          disabled={transcriptText.trim().length < 10}
                        >
                          <RiSaveLine className="w-4 h-4 mr-1" />
                          Save Transcript
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingTranscript(false);
                            setShowReanalyzeConfirm(false);
                          }}
                        >
                          <RiCloseLine className="w-4 h-4 mr-1" />
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                    {transcript.text}
                  </p>
                  <Button size="sm" variant="outline" onClick={startEditingTranscript}>
                    <RiPencilLine className="w-4 h-4 mr-1" />
                    Edit Transcript
                  </Button>
                </>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Printable content wrapper */}
      <div ref={printRef}>
        {/* Print-only header */}
        <div className="hidden print:block">
          <h1>Clinical Note — {cn.format ? formatLabel(cn.format) : "SOAP"}</h1>
          <div className="meta">
            {call.employee?.name && <span>Provider: {call.employee.name} | </span>}
            {call.uploadedAt && <span>Date: {new Date(call.uploadedAt).toLocaleDateString()} | </span>}
            {cn.providerAttested ? (
              <span>Status: Attested</span>
            ) : (
              <span className="draft">DRAFT — Requires Provider Attestation</span>
            )}
          </div>
        </div>

        {/* Chief Complaint */}
        {(cn.chiefComplaint || editing) && (
          <SectionCard
            title="Chief Complaint"
            icon={<RiFileTextLine className="w-4 h-4 text-red-500" />}
            editing={editing}
            editValue={editFields.chiefComplaint as string}
            onEditChange={handleFieldChange}
            fieldName="chiefComplaint"
          >
            {cn.chiefComplaint && <p className="font-medium">{cn.chiefComplaint}</p>}
          </SectionCard>
        )}

        {/* Quality Scores */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 print:hidden">
          {cn.documentationCompleteness != null && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Completeness</p>
                <p className="text-2xl font-bold">{cn.documentationCompleteness.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">/10</p>
              </CardContent>
            </Card>
          )}
          {cn.weightedCompleteness != null && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Weighted</p>
                <p
                  className={`text-2xl font-bold ${cn.weightedCompleteness >= 8 ? "text-green-600" : cn.weightedCompleteness >= 5 ? "text-amber-600" : "text-red-600"}`}
                >
                  {cn.weightedCompleteness.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">/10</p>
              </CardContent>
            </Card>
          )}
          {cn.clinicalAccuracy != null && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Accuracy</p>
                <p className="text-2xl font-bold">{cn.clinicalAccuracy.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">/10</p>
              </CardContent>
            </Card>
          )}
          {cn.format && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Format</p>
                <p className="text-lg font-semibold">{formatLabel(cn.format)}</p>
              </CardContent>
            </Card>
          )}
          {cn.specialty && (
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-xs text-muted-foreground">Specialty</p>
                <p className="text-sm font-medium capitalize">{cn.specialty.replace(/_/g, " ")}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Section Depth Indicators */}
        {cn.sectionDepth && Object.keys(cn.sectionDepth).length > 0 && (
          <Card className="print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Section Depth</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(cn.sectionDepth).map(([section, depth]) => {
                  const colors: Record<string, string> = {
                    empty: "bg-red-100 text-red-700 border-red-200",
                    minimal: "bg-amber-100 text-amber-700 border-amber-200",
                    adequate: "bg-blue-100 text-blue-700 border-blue-200",
                    thorough: "bg-green-100 text-green-700 border-green-200",
                  };
                  return (
                    <Badge key={section} variant="outline" className={`text-xs ${colors[depth] || ""}`}>
                      {section.replace(/([A-Z])/g, " $1").trim()}: {depth}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Format-specific sections */}
        <div className="space-y-4">
          {isBirp ? (
            /* --- BIRP Format --- */
            <>
              <SectionCard
                title="Behavior"
                icon={<RiPulseLine className="w-4 h-4 text-blue-500" />}
                empty="No behavior observations documented"
                editing={editing}
                editValue={editFields.behavior as string}
                onEditChange={handleFieldChange}
                fieldName="behavior"
              >
                {cn.behavior && <p className="text-sm whitespace-pre-wrap">{cn.behavior}</p>}
              </SectionCard>
              <SectionCard
                title="Intervention"
                icon={<RiMessage2Line className="w-4 h-4 text-green-500" />}
                empty="No interventions documented"
                editing={editing}
                editValue={editFields.intervention as string}
                onEditChange={handleFieldChange}
                fieldName="intervention"
              >
                {cn.intervention && <p className="text-sm whitespace-pre-wrap">{cn.intervention}</p>}
              </SectionCard>
              <SectionCard
                title="Response"
                icon={<RiListCheck2 className="w-4 h-4 text-purple-500" />}
                empty="No response documented"
                editing={editing}
                editValue={editFields.response as string}
                onEditChange={handleFieldChange}
                fieldName="response"
              >
                {cn.response && <p className="text-sm whitespace-pre-wrap">{cn.response}</p>}
              </SectionCard>
              <SectionCard
                title="Plan"
                icon={<RiCalendarLine className="w-4 h-4 text-orange-500" />}
                empty="No plan documented"
                editing={editing}
                editValue={((editFields.plan as string[]) || []).join("\n")}
                onEditChange={(_, v) => handlePlanChange(v)}
                fieldName="plan"
              >
                {cn.plan && cn.plan.length > 0 && (
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    {cn.plan.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          ) : isDap ? (
            /* --- DAP Format --- */
            <>
              <SectionCard
                title="Data"
                icon={<RiFileTextLine className="w-4 h-4 text-blue-500" />}
                empty="No data documented"
                editing={editing}
                editValue={editFields.data as string}
                onEditChange={handleFieldChange}
                fieldName="data"
              >
                {cn.data && <p className="text-sm whitespace-pre-wrap">{cn.data}</p>}
              </SectionCard>
              <SectionCard
                title="Assessment"
                icon={<RiStethoscopeLine className="w-4 h-4 text-purple-500" />}
                empty="No assessment documented"
                editing={editing}
                editValue={editFields.assessment as string}
                onEditChange={handleFieldChange}
                fieldName="assessment"
              >
                {cn.assessment && <p className="text-sm whitespace-pre-wrap">{cn.assessment}</p>}
              </SectionCard>
              <SectionCard
                title="Plan"
                icon={<RiCalendarLine className="w-4 h-4 text-orange-500" />}
                empty="No plan documented"
                editing={editing}
                editValue={((editFields.plan as string[]) || []).join("\n")}
                onEditChange={(_, v) => handlePlanChange(v)}
                fieldName="plan"
              >
                {cn.plan && cn.plan.length > 0 && (
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    {cn.plan.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          ) : (
            /* --- SOAP Format (default, including dental) --- */
            <>
              <SectionCard
                title="Subjective"
                icon={<RiFileTextLine className="w-4 h-4 text-blue-500" />}
                empty="No subjective findings documented"
                editing={editing}
                editValue={editFields.subjective as string}
                onEditChange={handleFieldChange}
                fieldName="subjective"
              >
                {cn.subjective && <p className="text-sm whitespace-pre-wrap">{cn.subjective}</p>}
              </SectionCard>
              <SectionCard
                title="Objective"
                icon={<RiListCheck2 className="w-4 h-4 text-green-500" />}
                empty="No objective findings documented"
                editing={editing}
                editValue={editFields.objective as string}
                onEditChange={handleFieldChange}
                fieldName="objective"
              >
                {cn.objective && <p className="text-sm whitespace-pre-wrap">{cn.objective}</p>}
              </SectionCard>
              <SectionCard
                title="Assessment"
                icon={<RiStethoscopeLine className="w-4 h-4 text-purple-500" />}
                empty="No assessment documented"
                editing={editing}
                editValue={editFields.assessment as string}
                onEditChange={handleFieldChange}
                fieldName="assessment"
              >
                {cn.assessment && <p className="text-sm whitespace-pre-wrap">{cn.assessment}</p>}
              </SectionCard>
              <SectionCard
                title="Plan"
                icon={<RiCalendarLine className="w-4 h-4 text-orange-500" />}
                empty="No plan documented"
                editing={editing}
                editValue={((editFields.plan as string[]) || []).join("\n")}
                onEditChange={(_, v) => handlePlanChange(v)}
                fieldName="plan"
              >
                {cn.plan && cn.plan.length > 0 && (
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    {cn.plan.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </>
          )}
        </div>

        {/* HPI Narrative (SOAP/HPI-focused) */}
        {(cn.hpiNarrative || editing) && !isDap && !isBirp && (
          <SectionCard
            title="History of Present Illness"
            icon={<RiFileTextLine className="w-4 h-4 text-indigo-500" />}
            editing={editing}
            editValue={editFields.hpiNarrative as string}
            onEditChange={handleFieldChange}
            fieldName="hpiNarrative"
          >
            {cn.hpiNarrative && <p className="text-sm whitespace-pre-wrap">{cn.hpiNarrative}</p>}
          </SectionCard>
        )}

        {/* Review of Systems */}
        {cn.reviewOfSystems && Object.keys(cn.reviewOfSystems).length > 0 && (
          <SectionCard title="Review of Systems" icon={<RiListCheck2 className="w-4 h-4 text-teal-500" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(cn.reviewOfSystems).map(([system, finding]) => (
                <div key={system} className="text-sm">
                  <span className="font-medium capitalize">{system.replace(/_/g, " ")}:</span>{" "}
                  <span className="text-muted-foreground">{finding}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Dental-specific sections */}
        {isDental && ((cn.toothNumbers && cn.toothNumbers.length > 0) || editing) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Teeth Involved</CardTitle>
              {editing && (
                <CardDescription className="text-xs">
                  Comma-separated tooth numbers (1-32 permanent, A-T primary)
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <Input
                  value={((editFields.toothNumbers as string[]) || []).join(", ")}
                  onChange={(e) => handleToothNumbersChange(e.target.value)}
                  placeholder="e.g. 3, 14, 19, 30"
                  className="font-mono text-sm"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {cn.toothNumbers?.map((tooth, i) => (
                    <Badge key={i} variant="outline" className="font-mono">
                      #{tooth}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isDental && ((cn.quadrants && cn.quadrants.length > 0) || editing) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quadrants</CardTitle>
              {editing && (
                <CardDescription className="text-xs">Comma-separated quadrants (UR, UL, LR, LL)</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {editing ? (
                <Input
                  value={((editFields.quadrants as string[]) || []).join(", ")}
                  onChange={(e) => handleQuadrantsChange(e.target.value)}
                  placeholder="e.g. UR, LL"
                  className="font-mono text-sm"
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {cn.quadrants?.map((q, i) => (
                    <Badge key={i} variant="outline">
                      {q}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isDental && cn.periodontalFindings && Object.keys(cn.periodontalFindings).length > 0 && (
          <SectionCard title="Periodontal Findings" icon={<RiPulseLine className="w-4 h-4 text-red-500" />}>
            <div className="space-y-2">
              {Object.entries(cn.periodontalFindings).map(([key, value]) => (
                <div key={key} className="text-sm">
                  <span className="font-medium capitalize">{key.replace(/_/g, " ")}:</span>{" "}
                  <span className="text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Codes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cn.icd10Codes && cn.icd10Codes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">ICD-10 Codes (Suggested)</CardTitle>
                <CardDescription className="text-xs">Requires provider verification</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {cn.icd10Codes.map((code, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <Badge
                        variant="outline"
                        className="font-mono text-xs cursor-pointer hover:bg-muted"
                        onClick={() => copyToClipboard(code.code)}
                        title="Click to copy"
                      >
                        {code.code}
                        <RiFileCopyLine className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
                      </Badge>
                      <span className="text-sm text-muted-foreground">{code.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {cn.cptCodes && cn.cptCodes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">CPT Codes (Suggested)</CardTitle>
                <CardDescription className="text-xs">Requires provider verification</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {cn.cptCodes.map((code, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <Badge
                        variant="outline"
                        className="font-mono text-xs cursor-pointer hover:bg-muted"
                        onClick={() => copyToClipboard(code.code)}
                        title="Click to copy"
                      >
                        {code.code}
                        <RiFileCopyLine className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
                      </Badge>
                      <span className="text-sm text-muted-foreground">{code.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {cn.cdtCodes && cn.cdtCodes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">CDT Codes (Suggested)</CardTitle>
                <CardDescription className="text-xs">Requires dentist verification</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {cn.cdtCodes.map((code, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <Badge
                        variant="outline"
                        className="font-mono text-xs cursor-pointer hover:bg-muted"
                        onClick={() => copyToClipboard(code.code)}
                        title="Click to copy"
                      >
                        {code.code}
                        <RiFileCopyLine className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />
                      </Badge>
                      <span className="text-sm text-muted-foreground">{code.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Prescriptions */}
        {cn.prescriptions && cn.prescriptions.length > 0 && (
          <SectionCard title="Prescriptions" icon={<RiCapsuleLine className="w-4 h-4 text-red-500" />}>
            <div className="space-y-2">
              {cn.prescriptions.map((rx, i) => (
                <div key={i} className="text-sm border-b last:border-0 pb-2 last:pb-0">
                  <span className="font-medium">{rx.medication}</span>
                  {rx.dosage && <span className="text-muted-foreground ml-2">{rx.dosage}</span>}
                  {rx.instructions && <p className="text-muted-foreground text-xs mt-0.5">{rx.instructions}</p>}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Follow-up */}
        {(cn.followUp || editing) && (
          <SectionCard
            title="Follow-up"
            icon={<RiCalendarLine className="w-4 h-4 text-cyan-500" />}
            editing={editing}
            editValue={editFields.followUp as string}
            onEditChange={handleFieldChange}
            fieldName="followUp"
          >
            {cn.followUp && <p className="font-medium">{cn.followUp}</p>}
          </SectionCard>
        )}
      </div>

      {/* Missing Sections */}
      {cn.missingSections && cn.missingSections.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-700 dark:text-amber-300">Missing Documentation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {cn.missingSections.map((section, i) => (
                <Badge key={i} variant="outline" className="text-amber-600 border-amber-300">
                  {section}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation Warnings (from server-side code/format validation) */}
      {(cn.validationWarnings?.length ?? 0) > 0 && (
        <Card className="border-blue-200 print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-blue-700 dark:text-blue-300 flex items-center gap-2">
              <RiInformationLine className="w-4 h-4" />
              Validation Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm space-y-1 text-blue-700 dark:text-blue-300">
              {cn.validationWarnings!.map((warning, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">&#8226;</span>
                  {warning}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Differential Diagnoses */}
      {cn.differentialDiagnoses && cn.differentialDiagnoses.length > 0 && (
        <SectionCard title="Differential Diagnoses" icon={<RiStethoscopeLine className="w-4 h-4 text-rose-500" />}>
          <ul className="text-sm space-y-1 list-disc list-inside">
            {cn.differentialDiagnoses.map((dx, i) => (
              <li key={i}>{dx}</li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Edit History */}
      {call.analysis?.clinicalNote?.editHistory?.length && call.analysis.clinicalNote.editHistory.length > 0 && (
        <Card className="print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-muted-foreground flex items-center gap-2">
              <RiHistoryLine className="w-4 h-4" />
              Edit History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {call.analysis.clinicalNote.editHistory.map((edit, i) => (
                <div key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span>{new Date(edit.editedAt).toLocaleString()}</span>
                  <span>—</span>
                  <span>
                    {edit.editedBy} edited {edit.fieldsChanged.join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quality Feedback — Post-attestation note quality rating */}
      {cn.providerAttested && !editing && (
        <Card className="print:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <RiStethoscopeLine className="w-4 h-4 text-primary" />
              AI Note Quality Feedback
            </CardTitle>
            <CardDescription className="text-xs">
              Rate how well the AI-generated note matched the encounter
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cn.qualityFeedback && cn.qualityFeedback.length > 0 && (
              <div className="mb-3 space-y-1">
                {cn.qualityFeedback.map((fb, i) => (
                  <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="font-mono">
                      {"★".repeat(fb.rating)}
                      {"☆".repeat(5 - fb.rating)}
                    </span>
                    <span>— {fb.ratedBy}</span>
                    {fb.comment && <span className="italic">"{fb.comment}"</span>}
                  </div>
                ))}
              </div>
            )}
            {showFeedback ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium mb-1">Rating</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setFeedbackRating(star)}
                        className={`text-xl ${star <= feedbackRating ? "text-amber-500" : "text-gray-300"} hover:text-amber-400`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium mb-1">Comment (optional)</p>
                  <Input
                    value={feedbackComment}
                    onChange={(e) => setFeedbackComment(e.target.value)}
                    placeholder="What could be improved?"
                    className="text-sm h-8"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => feedbackMutation.mutate()}
                    disabled={feedbackRating === 0 || feedbackMutation.isPending}
                  >
                    {feedbackMutation.isPending ? "Submitting..." : "Submit"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowFeedback(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setShowFeedback(true)}>
                Rate Note Quality
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
