/**
 * Auxiliary card components rendered below the main clinical note.
 *
 * Each one is conditional and orthogonal to the others; extracting them
 * here keeps the parent page focused on the note-editor wiring rather
 * than the post-attestation review surface.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiInformationLine, RiHistoryLine, RiStethoscopeLine } from "@remixicon/react";
import type { ClinicalNoteWithMeta } from "./types";

export function MissingSectionsCard({ missingSections }: { missingSections?: string[] }) {
  if (!missingSections || missingSections.length === 0) return null;
  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-amber-700 dark:text-amber-300">Missing Documentation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {missingSections.map((section, i) => (
            <Badge key={i} variant="outline" className="text-amber-600 border-amber-300">
              {section}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ValidationNotesCard({ validationWarnings }: { validationWarnings?: string[] }) {
  if (!validationWarnings || validationWarnings.length === 0) return null;
  return (
    <Card className="border-blue-200 print:hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-blue-700 dark:text-blue-300 flex items-center gap-2">
          <RiInformationLine className="w-4 h-4" aria-hidden="true" />
          Validation Notes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="text-sm space-y-1 text-blue-700 dark:text-blue-300">
          {validationWarnings.map((warning, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-blue-400 mt-0.5">&#8226;</span>
              {warning}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function EditHistoryCard({ editHistory }: { editHistory?: ClinicalNoteWithMeta["editHistory"] }) {
  if (!editHistory || editHistory.length === 0) return null;
  return (
    <Card className="print:hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-muted-foreground flex items-center gap-2">
          <RiHistoryLine className="w-4 h-4" aria-hidden="true" />
          Edit History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {editHistory.map((edit, i) => (
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
  );
}

interface QualityFeedbackCardProps {
  qualityFeedback?: ClinicalNoteWithMeta["qualityFeedback"];
  showFeedback: boolean;
  onShowFeedback: () => void;
  onCancelFeedback: () => void;
  rating: number;
  onRatingChange: (rating: number) => void;
  comment: string;
  onCommentChange: (comment: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

/**
 * Post-attestation note quality rating card. State is owned by the parent
 * page (mutation lives in the same scope as the toast/queryClient) — this
 * component is purely presentational.
 */
export function QualityFeedbackCard({
  qualityFeedback,
  showFeedback,
  onShowFeedback,
  onCancelFeedback,
  rating,
  onRatingChange,
  comment,
  onCommentChange,
  onSubmit,
  isSubmitting,
}: QualityFeedbackCardProps) {
  return (
    <Card className="print:hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <RiStethoscopeLine className="w-4 h-4 text-primary" aria-hidden="true" />
          AI Note Quality Feedback
        </CardTitle>
        <CardDescription className="text-xs">Rate how well the AI-generated note matched the encounter</CardDescription>
      </CardHeader>
      <CardContent>
        {qualityFeedback && qualityFeedback.length > 0 && (
          <div className="mb-3 space-y-1">
            {qualityFeedback.map((fb, i) => (
              <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="font-mono" aria-label={`${fb.rating} out of 5 stars`}>
                  {"★".repeat(fb.rating)}
                  {"☆".repeat(5 - fb.rating)}
                </span>
                <span>— {fb.ratedBy}</span>
                {fb.comment && <span className="italic">&quot;{fb.comment}&quot;</span>}
              </div>
            ))}
          </div>
        )}
        {showFeedback ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium mb-1">Rating</p>
              <div className="flex gap-1" role="radiogroup" aria-label="Note quality rating">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => onRatingChange(star)}
                    className={`text-xl ${star <= rating ? "text-amber-500" : "text-gray-300"} hover:text-amber-400`}
                    role="radio"
                    aria-checked={star === rating}
                    aria-label={`${star} star${star === 1 ? "" : "s"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium mb-1">Comment (optional)</p>
              <Input
                value={comment}
                onChange={(e) => onCommentChange(e.target.value)}
                placeholder="What could be improved?"
                className="text-sm h-8"
                aria-label="Quality feedback comment"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={onSubmit} disabled={rating === 0 || isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit"}
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelFeedback}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={onShowFeedback}>
            Rate Note Quality
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
