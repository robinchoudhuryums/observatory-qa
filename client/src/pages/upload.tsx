import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import FileUpload from "@/components/upload/file-upload";
import AudioRecorder from "@/components/upload/audio-recorder";
import { HelpTip } from "@/components/ui/help-tip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CALL_CATEGORIES } from "@shared/schema";
import type { Employee } from "@shared/schema";
import { RiUploadLine as UploadIcon, RiMicLine } from "@remixicon/react";

type UploadTab = "file" | "record";

export default function Upload() {
  const [tab, setTab] = useState<UploadTab>("file");
  const [callCategory, setCallCategory] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const handleRecordingComplete = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("audioFile", file);
      if (callCategory) formData.append("callCategory", callCategory);
      if (employeeId && employeeId !== "__unassigned__") formData.append("employeeId", employeeId);

      const response = await fetch("/api/calls/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Upload failed");
      }

      toast({ title: "Recording Uploaded", description: "Your recording is now being processed." });
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Could not upload recording.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen" data-testid="upload-page">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            Upload Call Recordings
            <HelpTip text="Upload audio files (MP3, WAV, M4A, MP4, FLAC, OGG) to automatically transcribe and analyze. Processing takes 2-3 minutes. You'll get real-time status updates via the dashboard." />
          </h2>
          <p className="text-muted-foreground">
            Upload audio files to analyze with AssemblyAI for transcription and sentiment analysis
          </p>
        </div>
      </header>

      <div className="p-6">
        {/* Tab switcher */}
        <div className="flex rounded-lg bg-muted p-1 mb-6 max-w-sm" role="tablist" aria-label="Upload method">
          <button
            role="tab"
            aria-selected={tab === "file"}
            aria-controls="panel-file"
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              tab === "file" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("file")}
          >
            <UploadIcon className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Upload File
          </button>
          <button
            role="tab"
            aria-selected={tab === "record"}
            aria-controls="panel-record"
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              tab === "record"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("record")}
          >
            <RiMicLine className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Record Live
          </button>
        </div>

        {/* File upload tab */}
        {tab === "file" && (
          <div id="panel-file" role="tabpanel">
            <FileUpload />
          </div>
        )}

        {/* Record live tab */}
        {tab === "record" && (
          <div id="panel-record" role="tabpanel" className="space-y-4">
            <div className="bg-card rounded-lg border border-border p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-1.5">
                Record a Call
                <HelpTip text="Record a live call directly from your browser. Put your phone on speaker and position it near your computer's microphone." />
              </h3>

              {/* Call category and employee assignment */}
              <div className="flex flex-wrap items-end gap-3 mb-6">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground" htmlFor="call-type-select">Call Type</label>
                  <Select value={callCategory} onValueChange={setCallCategory}>
                    <SelectTrigger className="w-48" id="call-type-select" aria-label="Call type">
                      <SelectValue placeholder="Select call type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-muted-foreground" htmlFor="agent-select">Assign To</label>
                  <Select
                    value={employeeId || "__unassigned__"}
                    onValueChange={(v) => setEmployeeId(v === "__unassigned__" ? "" : v)}
                  >
                    <SelectTrigger className="w-52" id="agent-select" aria-label="Assign to agent">
                      <SelectValue placeholder="Select agent" />
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
              </div>

              <AudioRecorder onRecordingComplete={handleRecordingComplete} />

              {isUploading && (
                <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
                  <p className="text-sm text-blue-800 dark:text-blue-300">Uploading recording... Please wait.</p>
                </div>
              )}
            </div>

            {/* Tips card */}
            <div className="bg-card rounded-lg border border-border p-6">
              <h4 className="font-medium text-foreground mb-2">Recording Tips</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Place your phone on speaker mode close to the microphone</li>
                <li>- Use a quiet room to minimize background noise</li>
                <li>- Ensure your browser has microphone permissions enabled</li>
                <li>- Recordings are saved as WebM format and processed the same as uploaded files</li>
              </ul>
            </div>
          </div>
        )}

        {/* Instructions - only show on file upload tab */}
        {tab === "file" && (
          <div className="mt-8 bg-card rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Upload Instructions</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-medium text-foreground mb-2">Supported Formats</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>- MP3 - Most common audio format</li>
                  <li>- WAV - High quality uncompressed</li>
                  <li>- M4A - Apple audio format</li>
                  <li>- MP4 - Video files with audio</li>
                  <li>- FLAC - Lossless compression</li>
                  <li>- OGG - Open source format</li>
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-foreground mb-2">Processing Features</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>- Automatic speech-to-text transcription</li>
                  <li>- Real-time sentiment analysis</li>
                  <li>- Speaker identification</li>
                  <li>- Topic extraction and categorization</li>
                  <li>- Performance scoring</li>
                  <li>- AI-powered feedback generation</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Note:</strong> Processing typically takes 2-3 minutes per audio file. You'll receive real-time
                updates on the transcription status.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
