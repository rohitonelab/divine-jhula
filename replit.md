# Divine Jhula — Laddu Gopal Swing

An immersive devotional 3-D experience built with **TanStack Start** (React SSR), **React Three Fiber**, **Tailwind CSS v4**, and **shadcn/ui**.

## What it does

Renders an interactive temple swing (*jhula / jhulan*) scene where **Laddu Gopal** sits on a swing.  The user can grab the chains and drag the swing; it responds with realistic pendulum physics (damped `θ'' = −(g/L)·sinθ − b·θ'`), bell chimes at the apex, and flower-burst particle effects on release.

## Stack

| Layer | Tech |
|---|---|
| Framework | TanStack Start (SSR) |
| 3-D | React Three Fiber + Drei + Three.js |
| Styling | Tailwind CSS v4 |
| UI components | shadcn/ui (Radix UI) |
| Physics | Custom pendulum sim (no Rapier) |
| Build | Vite 8 via `@lovable.dev/vite-tanstack-config` |

## Running locally on Replit

```bash
npm run dev        # starts Vite dev server on port 8080
```

The **Start application** workflow runs `npm run dev` and exposes port 8080.

## Key files

| File | Purpose |
|---|---|
| `src/components/jhulan/Swing.tsx` | Main swing component — mesh classification, pivot rotation, pendulum, drag |
| `src/components/jhulan/JhulanScene.tsx` | Canvas, lighting, effects, audio |
| `src/components/jhulan/LadduGopal.tsx` | Laddu Gopal model with breathing/blink |
| `src/lib/models.ts` | GLB asset URL constants |
| `vite.config.ts` | Vite + TanStack Start config (`host: 0.0.0.0` for Replit IPv4) |

## Swing mechanics

The swing GLB is split at load time into two groups:

- **Static stand** — posts, crossbar, base; never moves.
- **Moving swing assembly** — chains + seat; rotates ±45° about Z around the chain attachment point on the crossbar.

Laddu Gopal is parented to the moving assembly so he follows the seat automatically.

Mesh classification uses name hints first, then geometry heuristics (span detection for posts, thin-and-tall for chains, wide-and-flat for seat).  In `DEV` mode a `console.table` logs every mesh name and its classification to help calibrate for new GLB files.

## User preferences

- Do not change the visual design or devotional theme.
- Keep the stand fully static; only the swing assembly moves.
- Physics must feel like a real pendulum — no Rapier.
