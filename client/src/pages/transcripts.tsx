import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import TranscriptViewer from "@/components/transcripts/transcript-viewer";
import { CallList } from "@/components/orrery";
import type { AuthUser } from "@shared/schema";
import { getQueryFn } from "@/lib/queryClient";
import { RiArrowRightSLine, RiHomeLine, RiDownloadLine } from "@remixicon/react";

/**
 * Transcripts page — two modes:
 *   - /transcripts        → list view (CallList with full filters)
 *   - /transcripts/:id    → detail view (TranscriptViewer with CallArc hero)
 *
 * The list mode dropped its `CallsTable` consumer in favor of the orrery
 * `CallList`. Detail mode is unchanged at this level — TranscriptViewer
 * does the new arc + transcript layout internally.
 */
export default function Transcripts() {
  const params = useParams();
  const callId = params?.id;

  const { data: user } = useQuery<AuthUser>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
  });
  const canExport = user?.role === "manager" || user?.role === "admin";

  // Detail mode — single call's transcript + arc.
  if (callId) {
    return (
      <div className="min-h-screen" data-testid="transcript-detail-page">
        <header className="bg-card border-b border-border px-6 py-4">
          <nav className="flex items-center text-sm text-muted-foreground mb-2">
            <Link href="/" className="hover:text-foreground transition-colors">
              <RiHomeLine className="w-4 h-4" />
            </Link>
            <RiArrowRightSLine className="w-3 h-3 mx-2" />
            <Link href="/transcripts" className="hover:text-foreground transition-colors">
              Transcripts
            </Link>
            <RiArrowRightSLine className="w-3 h-3 mx-2" />
            <span className="text-foreground font-medium">Call detail</span>
          </nav>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Call detail</h2>
            <p className="text-muted-foreground">
              Arc of moments synced to the transcript and audio playback.
            </p>
          </div>
        </header>
        <div className="p-6">
          <TranscriptViewer callId={callId} />
        </div>
      </div>
    );
  }

  // List mode — full filters / sort / pagination via the orrery CallList.
  return (
    <div className="min-h-screen" data-testid="transcripts-page">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Call Transcripts</h2>
            <p className="text-muted-foreground">Browse and analyze all call recordings and their transcripts.</p>
          </div>
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const link = document.createElement("a");
                link.href = "/api/export/calls";
                link.download = "";
                link.click();
              }}
            >
              <RiDownloadLine className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          )}
        </div>
      </header>

      <div className="p-6">
        <CallList mode="full" emptyTitle="No calls in this org yet." />
      </div>
    </div>
  );
}
