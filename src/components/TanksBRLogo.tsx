import logoTanksBR from "@/assets/logo-tanksbr.png";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function TanksBRLogo({ className }: Props) {
  return (
    <img
      src={logoTanksBR}
      alt="TanksBR"
      width={150}
      height={56}
      className={cn("block h-auto max-w-full object-contain", className)}
    />
  );
}
