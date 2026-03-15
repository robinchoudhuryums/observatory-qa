/**
 * Owl loading animation — replaces generic spinners with a branded
 * animated owl icon that fills in with a liquid effect.
 */
import { ObservatoryLogo } from "./observatory-logo";

interface OwlLoadingProps {
  text?: string;
  size?: number;
  className?: string;
}

export default function OwlLoading({ text = "Loading...", size = 48, className = "" }: OwlLoadingProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className="relative">
        {/* Background owl (faded) */}
        <div className="text-muted-foreground/20">
          <ObservatoryLogo variant="icon" height={size} />
        </div>
        {/* Foreground owl with liquid fill animation */}
        <div
          className="absolute inset-0 text-primary owl-fill-animation"
          style={{ clipPath: "inset(var(--fill-top) 0 0 0)" }}
        >
          <ObservatoryLogo variant="icon" height={size} />
        </div>
      </div>
      {text && <p className="text-sm text-muted-foreground animate-pulse">{text}</p>}
      <style>{`
        @keyframes owlFill {
          0% { --fill-top: 100%; }
          50% { --fill-top: 0%; }
          100% { --fill-top: 100%; }
        }
        .owl-fill-animation {
          animation: owlFill 2s ease-in-out infinite;
        }
        @property --fill-top {
          syntax: '<percentage>';
          initial-value: 100%;
          inherits: false;
        }
      `}</style>
    </div>
  );
}
