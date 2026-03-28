import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { IdleTimeoutState } from "@/hooks/use-idle-timeout";

interface IdleTimeoutOverlayProps extends IdleTimeoutState {
  onStayLoggedIn: () => void;
}

export function IdleTimeoutOverlay({ isWarning, remainingSeconds, onStayLoggedIn }: IdleTimeoutOverlayProps) {
  if (!isWarning) return null;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const display = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, "0")}` : `${seconds}s`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="alertdialog" aria-modal="true" aria-label="Session timeout warning">
      <Card className="w-full max-w-md mx-4 shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Session Timeout Warning</CardTitle>
          <CardDescription>You have been inactive for a while. Your session will expire soon.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="text-5xl font-mono font-bold tabular-nums text-destructive">{display}</div>
          <p className="text-sm text-muted-foreground text-center">You will be automatically logged out when the timer reaches zero.</p>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Button size="lg" onClick={onStayLoggedIn} autoFocus>Stay Logged In</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
