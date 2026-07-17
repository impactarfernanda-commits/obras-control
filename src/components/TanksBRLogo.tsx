import logoTanksBR from "@/assets/logo-tanksbr.png";
import { cn } from "@/lib/utils";

interface Props {
  variant?: "light" | "dark";
  size?: "sidebar" | "header" | "login";
  className?: string;
}

const sizeClasses = {
  sidebar: "w-[108px]",
  header: "w-[108px]",
  login: "w-[220px]",
} as const;

export function TanksBRLogo({ variant = "light", size = "header", className }: Props) {
  return (
    <img
      src={logoTanksBR}
      alt="TanksBR"
      width={598}
      height={296}
      data-logo-variant={variant}
      className={cn(
        "block h-auto max-w-full bg-transparent object-contain",
        sizeClasses[size],
        className,
      )}
    />
  );
}
