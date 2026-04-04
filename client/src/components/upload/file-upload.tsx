import { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { CALL_CATEGORIES } from "@shared/schema";
import type { Employee } from "@shared/schema";
import {
  RiUploadCloud2Line,
  RiFileMusicLine,
  RiCloseLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiLoader4Line,
  RiUploadLine,
  RiCheckLine,
  RiArrowDownSLine,
  RiSettings3Line,
} from "@remixicon/react";

interface UploadFile {
  file: File;
  employeeId: string;
  callCategory: string;
  progress: number;
  status: "pending" | "uploading" | "processing" | "completed" | "error";
  error?: string;
  callId?: string;
  processingStep?: string;
  processingProgress?: number;
  detailsOpen?: boolean;
}

const PROCESSING_STEPS = [
  { key: "uploading", label: "Uploading audio" },
  { key: "transcribing", label: "Transcribing" },
  { key: "analyzing", label: "AI analysis" },
  { key: "processing", label: "Processing results" },
  { key: "saving", label: "Saving" },
  { key: "completed", label: "Complete" },
];

export default function FileUpload() {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Listen for WebSocket call updates via the shared connection (dispatched by useWebSocket hook)
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data?.callId) {
        setUploadFiles((prev) =>
          prev.map((f) => {
            if (f.callId === data.callId) {
              const stepIndex = PROCESSING_STEPS.findIndex((s) => s.key === data.status);
              const progress =
                stepIndex >= 0 ? Math.round(((stepIndex + 1) / PROCESSING_STEPS.length) * 100) : f.processingProgress;
              return {
                ...f,
                processingStep: data.label || data.status,
                processingProgress: progress || 0,
                status:
                  data.status === "completed"
                    ? ("completed" as const)
                    : data.status === "failed"
                      ? ("error" as const)
                      : ("processing" as const),
                error: data.status === "failed" ? "Processing failed" : undefined,
              };
            }
            return f;
          }),
        );
      }
    };
    window.addEventListener("ws:call_update", handler);
    return () => window.removeEventListener("ws:call_update", handler);
  }, []);

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({
      file,
      employeeId,
      callCategory,
    }: {
      file: File;
      employeeId?: string;
      callCategory?: string;
    }) => {
      const formData = new FormData();
      formData.append("audioFile", file);
      if (employeeId) formData.append("employeeId", employeeId);
      if (callCategory) formData.append("callCategory", callCategory);

      // Use XMLHttpRequest for real upload progress tracking
      // (fetch API doesn't support progress events)
      return new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/calls/upload");
        xhr.withCredentials = true;

        // Get CSRF token from cookie
        const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
        if (csrfMatch) xhr.setRequestHeader("X-CSRF-Token", csrfMatch[1]);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploadFiles((prev) =>
              prev.map((f) =>
                f.file === file ? { ...f, progress: pct, status: "uploading" as const } : f,
              ),
            );
          }
        };

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data);
            } else {
              reject(new Error(data.message || "Upload failed"));
            }
          } catch {
            reject(new Error(`Upload failed (HTTP ${xhr.status})`));
          }
        };

        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.ontimeout = () => reject(new Error("Upload timed out"));
        xhr.timeout = 300000; // 5 minutes

        xhr.send(formData);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    },
    onError: (error) => {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map((file) => ({
      file,
      employeeId: "",
      callCategory: "",
      progress: 0,
      status: "pending" as const,
    }));
    setUploadFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const MAX_BATCH_SIZE = 20;
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB — matches server limit

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) {
        const reasons = rejected.map((r) => r.errors.map((e) => e.message).join(", ")).join("; ");
        toast({ title: "Some files rejected", description: reasons, variant: "destructive" });
      }
      const currentCount = uploadFiles.length;
      const allowed = accepted.slice(0, MAX_BATCH_SIZE - currentCount);
      if (allowed.length < accepted.length) {
        toast({
          title: "Batch limit",
          description: `Maximum ${MAX_BATCH_SIZE} files per batch. ${accepted.length - allowed.length} file(s) were skipped.`,
          variant: "destructive",
        });
      }
      onDrop(allowed);
    },
    accept: { "audio/*": [".mp3", ".wav", ".m4a", ".mp4", ".flac", ".ogg"] },
    maxSize: MAX_FILE_SIZE,
  });

  const updateFile = (index: number, updates: Partial<UploadFile>) => {
    setUploadFiles((prev) => prev.map((file, i) => (i === index ? { ...file, ...updates } : file)));
  };

  const removeFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (index: number) => {
    const fileData = uploadFiles[index];
    try {
      updateFile(index, { status: "uploading", progress: 0, processingStep: "Uploading to server..." });
      const result = await uploadMutation.mutateAsync({
        file: fileData.file,
        employeeId: fileData.employeeId || undefined,
        callCategory: fileData.callCategory || undefined,
      });
      // The API returns the call ID — track it for WebSocket updates
      const callId = result?.id || result?.callId;
      updateFile(index, {
        status: "processing",
        progress: 100,
        callId,
        processingStep: "Queued for processing...",
        processingProgress: 10,
      });
      toast({ title: "Upload Successful", description: "Your file is now being processed." });
    } catch (error) {
      updateFile(index, { status: "error", error: error instanceof Error ? error.message : "Upload failed" });
    }
  };

  const MAX_CONCURRENT = 3;

  const uploadAll = async () => {
    const pendingIndices = uploadFiles
      .map((file, index) => (file.status === "pending" ? index : -1))
      .filter((i) => i >= 0);

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < pendingIndices.length; i += MAX_CONCURRENT) {
      const batch = pendingIndices.slice(i, i + MAX_CONCURRENT);
      await Promise.allSettled(batch.map((idx) => uploadFile(idx)));
    }
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-1.5">
        Upload Call Recordings
        <HelpTip text="Upload audio files to automatically transcribe, analyze sentiment, score performance, and generate coaching insights. Processing takes 1-3 minutes per call." />
      </h3>
      <div
        {...getRootProps()}
        data-testid="file-upload-dropzone"
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <input {...getInputProps()} data-testid="file-input" />
        <RiUploadCloud2Line
          className={`mx-auto h-12 w-12 ${isDragActive ? "text-primary" : "text-muted-foreground"}`}
        />
        {uploadFiles.length >= MAX_BATCH_SIZE ? (
          <>
            <p className="mt-2 text-sm font-medium text-amber-600 dark:text-amber-400">
              Maximum {MAX_BATCH_SIZE} files reached
            </p>
            <p className="text-xs text-muted-foreground mt-1">Remove existing files to add more</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {isDragActive ? "Drop files here..." : "Drag & drop files here, or click to select files"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              MP3, WAV, M4A, MP4, FLAC, OGG — up to 100MB per file, {MAX_BATCH_SIZE} files max
            </p>
          </>
        )}
      </div>

      {uploadFiles.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-foreground">
              Files to Upload
              <span className="text-xs text-muted-foreground ml-2 font-normal">
                ({uploadFiles.filter((f) => f.status === "completed").length}/{uploadFiles.length} complete)
              </span>
            </h4>
            <div className="flex items-center gap-2">
              {uploadFiles.length > 1 && uploadFiles.some((f) => f.status !== "pending") && (
                <span className="text-xs text-muted-foreground">
                  {uploadFiles.filter((f) => f.status === "uploading" || f.status === "processing").length} in progress
                </span>
              )}
              {(() => {
                const pendingCount = uploadFiles.filter(
                  (f) => f.status === "pending" || f.status === "uploading" || f.status === "processing",
                ).length;
                const estimatedMinutes = Math.ceil(pendingCount * 2.5);
                return pendingCount > 0 &&
                  uploadFiles.some((f) => f.status === "uploading" || f.status === "processing") ? (
                  <span className="text-xs text-muted-foreground italic">~{estimatedMinutes} min remaining</span>
                ) : null;
              })()}
              {uploadFiles.some((f) => f.status === "pending") && (
                <Button
                  type="button"
                  onClick={uploadAll}
                  disabled={uploadMutation.isPending}
                  data-testid="upload-all-button"
                >
                  Upload All ({uploadFiles.filter((f) => f.status === "pending").length})
                </Button>
              )}
            </div>
          </div>
          {uploadFiles.map((fileData, index) => (
            <div key={index} className="p-4 bg-muted rounded-lg space-y-3">
              <div className="flex items-center space-x-3">
                <RiFileMusicLine className="text-primary w-8 h-8 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{fileData.file.name}</p>
                  <p className="text-xs text-muted-foreground">{(fileData.file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>

                {fileData.status === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => updateFile(index, { detailsOpen: !fileData.detailsOpen })}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      aria-expanded={fileData.detailsOpen}
                      aria-controls={`upload-details-${index}`}
                      aria-label={`Toggle upload details for ${fileData.file.name}`}
                    >
                      <RiSettings3Line className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Details</span>
                      <RiArrowDownSLine
                        className={`w-3 h-3 transition-transform ${fileData.detailsOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    <Button size="sm" variant="ghost" onClick={() => removeFile(index)} className="shrink-0">
                      <RiCloseLine className="w-4 h-4" />
                    </Button>
                  </>
                )}

                {fileData.status === "completed" && (
                  <div className="flex items-center gap-2 text-green-600">
                    <RiCheckboxCircleLine className="w-5 h-5" />
                    <span className="text-sm font-medium">Complete</span>
                    <Button size="sm" variant="ghost" onClick={() => removeFile(index)}>
                      <RiCloseLine className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {fileData.status === "error" && (
                  <div className="flex items-center gap-2 text-red-600">
                    <RiCloseCircleLine className="w-5 h-5" />
                    <span className="text-sm">{fileData.error}</span>
                    <Button size="sm" variant="ghost" onClick={() => removeFile(index)}>
                      <RiCloseLine className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Collapsible call details (progressive disclosure) */}
              {fileData.status === "pending" && fileData.detailsOpen && (
                <div id={`upload-details-${index}`} className="flex flex-wrap gap-2 pt-1 pl-11">
                  <Select onValueChange={(value) => updateFile(index, { callCategory: value })}>
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="Call type" />
                    </SelectTrigger>
                    <SelectContent>
                      {CALL_CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    onValueChange={(value) =>
                      updateFile(index, { employeeId: value === "__unassigned__" ? "" : value })
                    }
                  >
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue placeholder="Assign to agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__">
                        <span className="text-muted-foreground italic">Unassigned (auto-detect)</span>
                      </SelectItem>
                      {employees?.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Processing Progress Indicator */}
              {(fileData.status === "uploading" || fileData.status === "processing") && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <RiLoader4Line
                      className={`w-4 h-4 animate-spin ${
                        fileData.status === "uploading" ? "text-blue-500" : "text-violet-500"
                      }`}
                    />
                    <span
                      className={`text-xs font-medium ${
                        fileData.status === "uploading"
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-violet-600 dark:text-violet-400"
                      }`}
                    >
                      {fileData.processingStep || "Processing..."}
                    </span>
                  </div>
                  <div className="relative">
                    <Progress
                      value={fileData.processingProgress || 0}
                      className={`h-2 ${
                        fileData.status === "uploading" ? "[&>div]:bg-blue-500" : "[&>div]:bg-violet-500"
                      }`}
                    />
                  </div>
                  <div className="flex justify-between text-xs px-0.5">
                    {PROCESSING_STEPS.map((step, i) => {
                      const currentIdx = PROCESSING_STEPS.findIndex((s) =>
                        fileData.processingStep?.toLowerCase().includes(s.key),
                      );
                      const isDone = i < currentIdx;
                      const isCurrent = i === currentIdx;
                      return (
                        <span
                          key={step.key}
                          className={`inline-flex items-center gap-0.5 ${
                            isDone
                              ? "text-green-600 dark:text-green-400"
                              : isCurrent
                                ? "font-bold text-primary"
                                : "text-muted-foreground"
                          }`}
                        >
                          {isDone && <RiCheckLine className="w-3 h-3" />}
                          {isCurrent && (
                            <span className="relative flex h-2 w-2 mr-0.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                            </span>
                          )}
                          {step.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
