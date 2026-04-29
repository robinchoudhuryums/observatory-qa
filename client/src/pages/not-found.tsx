import { Card, CardContent } from "@/components/ui/card";
import { RiErrorWarningLine } from "@remixicon/react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <RiErrorWarningLine className="h-8 w-8 text-destructive" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist. Check the URL or return to the dashboard.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
