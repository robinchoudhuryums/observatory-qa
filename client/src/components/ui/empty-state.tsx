import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion } from "framer-motion";
import type { RemixiconComponentType } from "@remixicon/react";

interface EmptyStateProps {
  icon: RemixiconComponentType;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
    icon?: RemixiconComponentType;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
  compact?: boolean;
}

/**
 * Consistent empty state component with animated icon, aurora gradient accent,
 * and clear call-to-action. Use for any page/section with no data.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}: EmptyStateProps) {
  const ActionIcon = action?.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-8 px-4" : "py-16 px-6",
        className
      )}
    >
      {/* Animated icon with aurora glow */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.4, ease: "easeOut" }}
        className={cn(
          "relative flex items-center justify-center rounded-2xl mb-5",
          compact ? "w-14 h-14" : "w-20 h-20"
        )}
        style={{
          background: "linear-gradient(135deg, hsla(var(--brand-from), 0.15), hsla(var(--brand-to), 0.1))",
        }}
      >
        {/* Subtle outer glow ring */}
        <div
          className="absolute inset-0 rounded-2xl opacity-40 blur-md"
          style={{
            background: "linear-gradient(135deg, hsla(var(--brand-from), 0.2), hsla(var(--brand-to), 0.15))",
          }}
        />
        <Icon
          className={cn("relative", compact ? "w-7 h-7" : "w-9 h-9")}
          style={{ color: "hsl(var(--brand-from))" }}
        />
      </motion.div>

      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className={cn(
          "font-semibold text-foreground mb-1.5",
          compact ? "text-base" : "text-lg"
        )}
      >
        {title}
      </motion.h3>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.3 }}
        className={cn(
          "text-muted-foreground max-w-md",
          compact ? "text-xs mb-4" : "text-sm mb-6"
        )}
      >
        {description}
      </motion.p>

      {action && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          className="flex items-center gap-3"
        >
          {action.href ? (
            <Link href={action.href}>
              <Button className="brand-gradient-btn text-white border-0 shadow-md">
                {ActionIcon && <ActionIcon className="w-4 h-4 mr-2" />}
                {action.label}
              </Button>
            </Link>
          ) : (
            <Button
              className="brand-gradient-btn text-white border-0 shadow-md"
              onClick={action.onClick}
            >
              {ActionIcon && <ActionIcon className="w-4 h-4 mr-2" />}
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            secondaryAction.href ? (
              <Link href={secondaryAction.href}>
                <Button variant="outline">{secondaryAction.label}</Button>
              </Link>
            ) : (
              <Button variant="outline" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
