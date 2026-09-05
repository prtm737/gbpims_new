import campus from "@/assets/gbp-campus.jpg.asset.json";
import { cn } from "@/lib/utils";

/**
 * Guwahati Biotech Park campus photograph used as a soft, fixed backdrop.
 * `variant="page"` is the whisper-quiet app background; `variant="feature"`
 * is the richer treatment used behind heroes and the sign-in card.
 */
export function AppBackdrop({
  variant = "page",
  className,
}: {
  variant?: "page" | "feature";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        variant === "page"
          ? "pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
          : "pointer-events-none absolute inset-0 z-0 overflow-hidden select-none",
        className,
      )}
    >
      <img
        src={campus.url}
        alt=""
        loading={variant === "feature" ? "eager" : "lazy"}
        decoding="async"
        className={cn(
          "size-full object-cover",
          variant === "page" ? "opacity-40 saturate-[0.8]" : "opacity-95",
        )}
      />
      <div
        className={cn(
          "absolute inset-0",
          variant === "page"
            ? "bg-gradient-to-b from-background/92 via-background/95 to-background/98"
            : "bg-gradient-to-br from-sidebar/97 via-sidebar/90 to-sidebar/70",
        )}
      />
    </div>
  );
}