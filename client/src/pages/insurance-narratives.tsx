import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, getQueryFn, csrfFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { INSURANCE_LETTER_TYPES, type InsuranceNarrative } from "@shared/schema";
import {
  RiFileTextLine,
  RiAddLine,
  RiFileCopyLine,
  RiRefreshLine,
  RiDeleteBinLine,
  RiCheckboxCircleLine,
  RiTimeLine,
  RiSendPlaneLine,
  RiInputMethodLine,
} from "@remixicon/react";

const statusColors: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  finalized: "bg-blue-100 text-blue-800",
  submitted: "bg-green-100 text-green-800",
};

/** Inline editor for draft narratives — allows direct text editing before finalization */
function NarrativeEditor({
  narrative,
  onSave,
  isSaving,
}: {
  narrative: InsuranceNarrative;
  onSave: (text: string) => void;
  isSaving: boolean;
}) {
  const [editText, setEditText] = useState(narrative.generatedNarrative || "");
  const isDirty = editText !== (narrative.generatedNarrative || "");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Edit the letter text below. Changes are saved when you click Save.
        </p>
        {isDirty && (
          <Button size="sm" onClick={() => onSave(editText)} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>
      <Textarea
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        className="font-mono text-sm min-h-[400px]"
        rows={20}
      />
    </div>
  );
}

export default function InsuranceNarrativesPage() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedNarrative, setSelectedNarrative] = useState<InsuranceNarrative | null>(null);
  const [form, setForm] = useState({
    patientName: "",
    patientDob: "",
    memberId: "",
    insurerName: "",
    insurerAddress: "",
    letterType: "prior_auth",
    clinicalJustification: "",
    priorDenialReference: "",
  });

  const { data: narratives = [] } = useQuery<InsuranceNarrative[]>({
    queryKey: ["/api/insurance-narratives"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await csrfFetch("/api/insurance-narratives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create narrative");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance-narratives"] });
      setShowCreate(false);
      setSelectedNarrative(data);
      toast({ title: "Insurance narrative generated" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; status?: string; generatedNarrative?: string }) => {
      const res = await csrfFetch(`/api/insurance-narratives/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance-narratives"] });
      setSelectedNarrative(data);
      toast({ title: "Narrative updated" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await csrfFetch(`/api/insurance-narratives/${id}/regenerate`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to regenerate");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance-narratives"] });
      setSelectedNarrative(data);
      toast({ title: "Narrative regenerated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await csrfFetch(`/api/insurance-narratives/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurance-narratives"] });
      setSelectedNarrative(null);
      toast({ title: "Narrative deleted" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RiFileTextLine className="w-6 h-6 text-primary" />
            Insurance Narratives
          </h1>
          <p className="text-muted-foreground">Generate prior authorization and appeal letters</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>
              <RiAddLine className="w-4 h-4 mr-2" /> New Narrative
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Insurance Narrative</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Letter Type</Label>
                <Select value={form.letterType} onValueChange={(v) => setForm((f) => ({ ...f, letterType: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INSURANCE_LETTER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Patient Name *</Label>
                  <Input
                    value={form.patientName}
                    onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input
                    type="date"
                    value={form.patientDob}
                    onChange={(e) => setForm((f) => ({ ...f, patientDob: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label>Member ID</Label>
                <Input value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))} />
              </div>
              <div>
                <Label>Insurance Company *</Label>
                <Input
                  value={form.insurerName}
                  onChange={(e) => setForm((f) => ({ ...f, insurerName: e.target.value }))}
                />
              </div>
              <div>
                <Label>Clinical Justification</Label>
                <Textarea
                  value={form.clinicalJustification}
                  onChange={(e) => setForm((f) => ({ ...f, clinicalJustification: e.target.value }))}
                  placeholder="Clinical findings and medical necessity..."
                  rows={3}
                />
              </div>
              {form.letterType === "appeal" && (
                <div>
                  <Label>Prior Denial Reference</Label>
                  <Input
                    value={form.priorDenialReference}
                    onChange={(e) => setForm((f) => ({ ...f, priorDenialReference: e.target.value }))}
                    placeholder="Claim/denial number"
                  />
                </div>
              )}
              <Button
                className="w-full"
                onClick={() => createMutation.mutate(form)}
                disabled={!form.patientName || !form.insurerName || createMutation.isPending}
              >
                {createMutation.isPending ? "Generating..." : "Generate Narrative"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Narratives List */}
        <div className="space-y-3">
          {narratives.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No narratives yet. Create one to get started.
              </CardContent>
            </Card>
          ) : (
            narratives.map((n) => (
              <Card
                key={n.id}
                className={`cursor-pointer transition-colors ${selectedNarrative?.id === n.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => setSelectedNarrative(n)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{n.patientName}</p>
                      <p className="text-sm text-muted-foreground">{n.insurerName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {INSURANCE_LETTER_TYPES.find((t) => t.value === n.letterType)?.label || n.letterType}
                        </Badge>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[n.status || "draft"]}`}
                        >
                          {n.status}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ""}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Narrative Detail / Editor */}
        <div className="lg:col-span-2">
          {selectedNarrative ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{selectedNarrative.patientName}</CardTitle>
                    <CardDescription>
                      {INSURANCE_LETTER_TYPES.find((t) => t.value === selectedNarrative.letterType)?.label} —{" "}
                      {selectedNarrative.insurerName}
                    </CardDescription>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {selectedNarrative.patientDob && <span>DOB: {selectedNarrative.patientDob}</span>}
                      {selectedNarrative.memberId && <span>Member: {selectedNarrative.memberId}</span>}
                      {selectedNarrative.createdBy && <span>By: {selectedNarrative.createdBy}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => regenerateMutation.mutate(selectedNarrative.id)}
                      disabled={regenerateMutation.isPending || selectedNarrative.status === "submitted"}
                    >
                      <RiRefreshLine className="w-4 h-4 mr-1" />{" "}
                      {regenerateMutation.isPending ? "Regenerating..." : "Regenerate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedNarrative.generatedNarrative || "");
                        toast({ title: "Copied to clipboard" });
                      }}
                    >
                      <RiFileCopyLine className="w-4 h-4 mr-1" /> Copy
                    </Button>
                    {selectedNarrative.status === "draft" && (
                      <Button
                        size="sm"
                        onClick={() => updateMutation.mutate({ id: selectedNarrative.id, status: "finalized" })}
                      >
                        <RiCheckboxCircleLine className="w-4 h-4 mr-1" /> Finalize
                      </Button>
                    )}
                    {selectedNarrative.status === "finalized" && (
                      <Button
                        size="sm"
                        onClick={() => updateMutation.mutate({ id: selectedNarrative.id, status: "submitted" })}
                      >
                        <RiSendPlaneLine className="w-4 h-4 mr-1" /> Mark Submitted
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => deleteMutation.mutate(selectedNarrative.id)}>
                      <RiDeleteBinLine className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedNarrative.status === "draft" ? (
                  <NarrativeEditor
                    narrative={selectedNarrative}
                    onSave={(text) => updateMutation.mutate({ id: selectedNarrative.id, generatedNarrative: text })}
                    isSaving={updateMutation.isPending}
                  />
                ) : (
                  <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                    {selectedNarrative.generatedNarrative || "No narrative generated yet."}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {selectedNarrative.diagnosisCodes &&
                    (selectedNarrative.diagnosisCodes as Array<{ code: string; description: string }>).length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Diagnosis Codes</p>
                        <div className="flex flex-wrap gap-2">
                          {(selectedNarrative.diagnosisCodes as Array<{ code: string; description: string }>).map(
                            (c, i) => (
                              <Badge key={i} variant="secondary">
                                {c.code}: {c.description}
                              </Badge>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  {selectedNarrative.procedureCodes &&
                    (selectedNarrative.procedureCodes as Array<{ code: string; description: string }>).length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Procedure Codes</p>
                        <div className="flex flex-wrap gap-2">
                          {(selectedNarrative.procedureCodes as Array<{ code: string; description: string }>).map(
                            (c, i) => (
                              <Badge key={i} variant="outline">
                                {c.code}: {c.description}
                              </Badge>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                </div>
                {selectedNarrative.clinicalJustification && (
                  <div>
                    <p className="text-sm font-medium mb-1">Clinical Justification</p>
                    <p className="text-sm text-muted-foreground">{selectedNarrative.clinicalJustification}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                Select a narrative from the list or create a new one
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
