import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "light" | "dark" | "ghost" | "danger" | "outline";
type Size = "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white active:brightness-90",
  light: "bg-white text-black active:bg-white/85",
  dark: "bg-black text-white border border-white/15 active:bg-white/5",
  ghost: "bg-card text-fg border border-line active:bg-card-2",
  outline: "bg-transparent text-fg border border-line active:bg-card",
  danger: "bg-danger/15 text-danger border border-danger/30 active:bg-danger/25",
};

const sizes: Record<Size, string> = {
  md: "h-11 rounded-xl px-4 text-[15px]",
  lg: "h-14 rounded-2xl px-5 text-base",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = "primary", size = "md", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2.5 font-medium transition-[background-color,filter,transform] active:scale-[0.98]",
        "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
