import logoTanksBR from "@/assets/logo-tanksbr.png";
import { cn } from "@/lib/utils";

interface Props {
  variant?: "light" | "dark";
  size?: "sidebar" | "header" | "login" | "compact";
  className?: string;
}

const sizeClasses = {
  sidebar: "h-8 w-auto max-w-[140px]",
  header: "h-6 w-auto max-w-[105px]",
  login: "h-16 w-auto max-w-[280px]",
  compact: "h-auto w-10",
} as const;

export function TanksBRLogo({ variant = "light", size = "header", className }: Props) {
  return (
    <img
      src={logoTanksBR}
      alt="TanksBR"
      width={1881}
      height={430}
      data-logo-variant={variant}
      className={cn(
        "block h-auto max-w-full bg-transparent object-contain",
        sizeClasses[size],
        className,
      )}
    />
  );
}
