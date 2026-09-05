import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Office logo lockup. `variant="mark"` renders only the emblem. */
export function BrandLogo({
  className,
  variant = "full",
  subtitle,
}: {
  className?: string;
  variant?: "full" | "mark";
  subtitle?: string;
}) {
  if (variant === "mark") {
    return (
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white",
          className,
        )}
      >
        <img
          src={BRAND.logoUrl}
          alt={`${BRAND.org} logo`}
          width={80}
          height={80}
          className="h-7 w-7 object-contain object-left"
          style={{ objectPosition: "left center", width: "1.75rem" }}
        />
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex items-center justify-center rounded-xl bg-white px-2 py-1.5">
        <img
          src={BRAND.logoUrl}
          alt={`${BRAND.org} logo`}
          width={249}
          height={80}
          className="h-7 w-auto object-contain"
        />
      </span>
      {subtitle && (
        <span className="text-[10px] leading-tight tracking-[0.14em] uppercase opacity-70">
          {subtitle}
        </span>
      )}
    </span>
  );
}
