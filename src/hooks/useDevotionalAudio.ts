import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Very small audio manager: procedurally synthesizes flute-ish drone, wind,
 * wooden creak, and a temple bell using the WebAudio API — so we ship no
 * audio assets and stay well within the "autoplay disabled until interaction"
 * rule.
 */
export function useDevotionalAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const creakNodesRef = useRef<{ osc: OscillatorNode; gain: GainNode } | null>(null);

  const ensureCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    ctxRef.current = ctx;
    masterRef.current = master;
    return ctx;
  }, []);

  const startAmbience = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx || !masterRef.current) return;
    if (ctx.state === "suspended") ctx.resume();

    // Soft flute drone: two detuned sine oscillators with slow LFO tremolo
    const flute = ctx.createGain();
    flute.gain.value = 0;
    flute.connect(masterRef.current);
    flute.gain.setTargetAtTime(0.12, ctx.currentTime, 3);

    const notes = [220, 277.18, 329.63]; // A3, C#4, E4
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25 / (i + 1);
      osc.connect(g).connect(flute);
      osc.start();

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.15 + i * 0.05;
      lfoGain.gain.value = 1.5;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start();
    });

    // Wind: filtered noise
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 500;
    bp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.04;
    noise.connect(bp).connect(wg).connect(masterRef.current);
    noise.start();

    // Wooden creak preset (started/updated based on swing motion)
    const creakOsc = ctx.createOscillator();
    creakOsc.type = "sawtooth";
    creakOsc.frequency.value = 90;
    const creakFilter = ctx.createBiquadFilter();
    creakFilter.type = "lowpass";
    creakFilter.frequency.value = 400;
    const creakGain = ctx.createGain();
    creakGain.gain.value = 0;
    creakOsc.connect(creakFilter).connect(creakGain).connect(masterRef.current);
    creakOsc.start();
    creakNodesRef.current = { osc: creakOsc, gain: creakGain };

    setEnabled(true);
  }, [ensureCtx]);

  const bell = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !masterRef.current) return;
    const now = ctx.currentTime;
    const partials = [523.25, 1046.5, 1567.98];
    partials.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.4 / (i + 1), now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2 - i * 0.4);
      osc.connect(g).connect(masterRef.current!);
      osc.start(now);
      osc.stop(now + 2.3);
    });
  }, []);

  const setSwingIntensity = useCallback((intensity: number) => {
    const nodes = creakNodesRef.current;
    const ctx = ctxRef.current;
    if (!nodes || !ctx) return;
    const target = Math.min(0.06, Math.max(0, intensity * 0.06));
    nodes.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
    nodes.osc.frequency.setTargetAtTime(70 + intensity * 40, ctx.currentTime, 0.25);
  }, []);

  const toggleMute = useCallback(() => {
    const master = masterRef.current;
    if (!master) return;
    setMuted((m) => {
      const next = !m;
      master.gain.setTargetAtTime(next ? 0 : 0.5, ctxRef.current!.currentTime, 0.1);
      return next;
    });
  }, []);

  useEffect(() => () => { ctxRef.current?.close(); }, []);

  return { startAmbience, bell, setSwingIntensity, enabled, muted, toggleMute };
}
