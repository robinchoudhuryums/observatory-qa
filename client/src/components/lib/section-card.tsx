import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

/**
 * Reusable section card for clinical notes, reports, and other detail views.
 * Supports view mode (renders children) and edit mode (renders textarea).
 *
 * Extracted from clinical-notes.tsx for reuse across pages.
 */
export function SectionCard({
  title,
  icon,
  children,
  empty,
  editing,
  editValue,
  onEditChange,
  fieldName,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  empty?: string;
  editing?: boolean;
  editValue?: string;
  onEditChange?: (field: string, value: string) => void;
  fieldName?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {editing && fieldName ? (
          <Textarea
            value={editValue || ""}
            onChange={(e) => onEditChange?.(fieldName, e.target.value)}
            className="min-h-[100px] text-sm"
          />
        ) : (
          children || <p className="text-sm text-muted-foreground italic">{empty || "Not documented"}</p>
        )}
      </CardContent>
    </Card>
  );
}
