import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useState } from "react";
import { LoadingScreen } from "@/components/jhulan/LoadingScreen";

const JhulanScene = lazy(() =>
  import("@/components/jhulan/JhulanScene").then((m) => ({ default: m.JhulanScene }))
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Jhulan · A Devotional Swing for Laddu Gopal" },
      {
        name: "description",
        content:
          "A serene, physics-based devotional experience: gently swing Laddu Gopal on a wooden Jhula bathed in Vrindavan sunrise light. Grab a rope to swing.",
      },
      { property: "og:title", content: "Jhulan · A Devotional Swing for Laddu Gopal" },
      {
        property: "og:description",
        content:
          "Swing Laddu Gopal on a real-physics Jhula, with temple ambience, flower petals, and soft flute — inspired by Vrindavan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [started, setStarted] = useState(false);

  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      {/* Canvas / scene */}
      <Suspense fallback={<LoadingScreen />}>
        <JhulanScene started={started} onStart={() => setStarted(true)} />
      </Suspense>

      {/* Persistent loading overlay while GLBs stream */}
      <LoadingScreen />

      {/* Header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-5 sm:p-8">
        <div className="animate-fade-in-up">
          <p className="text-[11px] uppercase tracking-[0.32em] text-foreground/70">॥ श्री कृष्ण ॥</p>
          <h1 className="font-display text-3xl leading-none sm:text-4xl text-gold-gradient">
            Jhulan
          </h1>
        </div>
        <div className="pointer-events-auto glass-panel hidden animate-fade-in-up rounded-full px-4 py-2 text-xs text-foreground/80 sm:block">
          Grab a rope · pull gently · release to swing
        </div>
      </header>

      {/* Bottom hint */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center justify-center gap-2 p-5 text-center sm:p-8">
        {!started && (
          <button
            onClick={() => setStarted(true)}
            className="pointer-events-auto animate-soft-pulse rounded-full border px-6 py-3 font-display text-lg tracking-wide text-foreground shadow-[var(--shadow-temple)]"
            style={{
              background:
                "linear-gradient(135deg, oklch(0.98 0.06 90 / 0.85), oklch(0.9 0.15 75 / 0.85))",
              borderColor: "oklch(0.7 0.15 55 / 0.6)",
            }}
          >
            Begin the darshan
          </button>
        )}
        <p className="mt-1 text-[11px] uppercase tracking-[0.28em] text-foreground/60">
          Touch or click a rope to swing · Sound begins on interaction
        </p>
      </footer>

      {/* Warm vignette overlay for atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, transparent 50%, oklch(0.55 0.18 40 / 0.35) 100%)",
        }}
      />
    </main>
  );
}
