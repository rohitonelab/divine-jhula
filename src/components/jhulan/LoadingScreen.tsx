import { useProgress } from "@react-three/drei";

export function LoadingScreen() {
  const { progress, active } = useProgress();
  return (
    <div
      aria-live="polite"
      aria-busy={active}
      className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center transition-opacity duration-700"
      style={{
        opacity: active || progress < 100 ? 1 : 0,
        background:
          "radial-gradient(ellipse at center, oklch(0.95 0.06 80) 0%, oklch(0.86 0.12 55) 100%)",
      }}
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative h-24 w-24 animate-soft-pulse">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "radial-gradient(circle, oklch(0.95 0.15 85) 0%, oklch(0.8 0.18 55) 60%, transparent 75%)",
              filter: "blur(2px)",
            }}
          />
          <div
            className="absolute inset-3 rounded-full border"
            style={{
              borderColor: "oklch(0.5 0.15 45 / 0.6)",
              background:
                "radial-gradient(circle, oklch(0.98 0.05 85) 0%, oklch(0.85 0.15 65) 100%)",
              boxShadow: "0 0 30px oklch(0.87 0.16 90 / 0.7)",
            }}
          />
        </div>
        <div className="text-center">
          <p className="font-display text-2xl text-gold-gradient">Jai Shri Krishna</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Preparing the Jhula · {Math.round(progress)}%
          </p>
        </div>
        <div className="h-1 w-56 overflow-hidden rounded-full bg-white/40">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{
              width: `${progress}%`,
              background:
                "linear-gradient(90deg, oklch(0.72 0.19 45), oklch(0.87 0.16 90))",
            }}
          />
        </div>
      </div>
    </div>
  );
}
