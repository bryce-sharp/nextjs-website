"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import CloseIcon from "@mui/icons-material/Close";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import ReplayIcon from "@mui/icons-material/Replay";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import CheckIcon from "@mui/icons-material/Check";
import FitnessCenterIcon from "@mui/icons-material/FitnessCenter";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import {
  buildSteps,
  clock,
  formatDuration,
  parseLeadingInt,
  parseTips,
  SECTIONS,
  type RunStep,
  type ResolvedItem,
} from "@/lib/workout";
import ExerciseInfoButton from "@/components/workout/ExerciseInfoButton";
import { RUN_TIMING, RUN_CUES } from "@/lib/workout-config";

// ── Timing plan derived from a step ───────────────────────────────────────────
type Plan =
  | { type: "timer"; total: number; label: "rest" | "work" }
  | {
      type: "repsTimed";
      reps: number;
      per: number;
      repsText: string;
      holdLast: boolean;
    }
  | { type: "manual"; repsText: string | null };

function planFor(step: RunStep): Plan {
  if (step.kind === "rest")
    return { type: "timer", total: step.seconds, label: "rest" };
  const it = step.item;
  if (it.reps) {
    const n = parseLeadingInt(it.reps);
    if (it.duration && n)
      return {
        type: "repsTimed",
        reps: n,
        per: it.duration,
        repsText: it.reps,
        holdLast: it.holdLast,
      };
    return { type: "manual", repsText: it.reps };
  }
  if (it.duration != null)
    return { type: "timer", total: it.duration, label: "work" };
  return { type: "manual", repsText: null };
}

// When "hold last" is on, the final rep is stretched to
//   build (per/2) → HOLD at the top (per × holdRatio) → fall (per/2)
// so it lasts `per × (1 + holdRatio)`. At the default holdRatio of 1 that's the
// classic 2× rep; bump holdRatio in RUN_TIMING for a longer top-hold.
function repDuration(
  plan: Extract<Plan, { type: "repsTimed" }>,
  repNum: number,
): number {
  return plan.holdLast && repNum === plan.reps
    ? plan.per * (1 + RUN_TIMING.holdRatio)
    : plan.per;
}

const sectionLabel = (s: string) =>
  SECTIONS.find((x) => x.value === s)?.label ?? s;

// Stable identity for a WORK step (survives a step-list rebuild when the
// auto-advance toggle flips). Rests return null — they aren't anchors.
function workKey(s: RunStep | undefined): string | null {
  if (!s || s.kind !== "work") return null;
  return `${s.item.itemId}:${s.round ?? 0}:${s.side?.index ?? 0}`;
}

// Like workKey, but a between-rounds "Rest" (present in both modes) is keyed by
// the work step it precedes. Lead-ins return null.
function stepKey(steps: RunStep[], idx: number): string | null {
  const s = steps[idx];
  if (s?.kind === "rest" && s.label === "Rest") {
    const next = steps.slice(idx + 1).find((x) => x.kind === "work");
    return `rest>${workKey(next)}`;
  }
  return workKey(s);
}

// The step to re-anchor to from a given position: the current one if it's work
// or a between-rounds rest, else the next work step (e.g. when sitting on a
// "Get ready" gap that won't exist in manual mode), else the previous.
function anchorKey(steps: RunStep[], idx: number): string | null {
  const here = stepKey(steps, idx);
  if (here) return here;
  for (let i = idx; i < steps.length; i++) {
    const k = workKey(steps[i]);
    if (k) return k;
  }
  for (let i = idx - 1; i >= 0; i--) {
    const k = workKey(steps[i]);
    if (k) return k;
  }
  return null;
}

// ── Circular dial (static ring + centered content + an inner "breath" disc) ────
function Dial({
  fraction,
  inner,
  color,
  flash,
  hold,
  children,
  onClick,
}: {
  fraction: number; // 0..1 of the outer ring filled
  inner?: number; // 0..1 filled inner "breath" disc (reps); omit for plain timers
  color: string;
  flash?: boolean;
  hold?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const size = 260;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  const ringColor = hold
    ? "var(--mui-palette-warning-main)"
    : flash
      ? "var(--mui-palette-success-main)"
      : color;
  const innerMaxR = r - stroke * 1.4;
  const innerR =
    inner == null ? 0 : innerMaxR * Math.max(0, Math.min(1, inner));

  return (
    <Box
      onClick={onClick}
      sx={{
        // Square, but sized to fit both width and remaining height so the
        // runner never scrolls. viewBox stays 260 (just a coordinate space).
        width: "min(72vw, 42vh, 320px)",
        height: "min(72vw, 42vh, 320px)",
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        mx: "auto",
      }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--mui-palette-divider)"
          strokeWidth={stroke}
        />
        {/* inner breathing disc — only this "breathes", the ring stays put */}
        {inner != null ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={innerR}
            fill={ringColor}
            fillOpacity={hold ? 0.4 : 0.16}
            style={{ transition: "r 140ms linear, fill-opacity 200ms" }}
          />
        ) : null}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          px: 2,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

export default function WorkoutRunner({
  workoutId,
  workoutName,
  items,
  rounds,
  restBetweenRounds,
}: {
  workoutId: number;
  workoutName: string;
  items: ResolvedItem[];
  rounds: number;
  restBetweenRounds: number;
}) {
  const router = useRouter();

  const [started, setStarted] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const [remaining, setRemaining] = React.useState(0);
  const [rep, setRep] = React.useState(0);
  const [finished, setFinished] = React.useState(false); // timer hit 0, awaiting manual Next
  const [awaitingStart, setAwaitingStart] = React.useState(false); // manual mode: timed step ready, not started
  const [flash, setFlash] = React.useState(false);
  const [autoAdvance, setAutoAdvance] = React.useState(true);
  const [muted, setMuted] = React.useState(false);
  const [tipIndex, setTipIndex] = React.useState(0);

  const deadlineRef = React.useRef(0);
  const repRef = React.useRef(0);
  const holdBeepedRef = React.useRef(false);
  const audioRef = React.useRef<AudioContext | null>(null);
  const wakeRef = React.useRef<WakeLockSentinel | null>(null);
  const anchorKeyRef = React.useRef<string | null>(null);
  const mutedRef = React.useRef(false); // live value for the clock loop
  // Fire-once guards for the per-timer cues (reset each step in initStep).
  const cuesRef = React.useRef({
    half: false,
    quarter: false,
    cd3: false,
    cd2: false,
    cd1: false,
  });

  // The runner owns the step sequence because it depends on the (client-side)
  // auto-advance toggle: manual mode drops the "Get ready" / "Switch" lead-ins.
  const steps = React.useMemo(
    () => buildSteps(items, rounds, restBetweenRounds, { autoAdvance }),
    [items, rounds, restBetweenRounds, autoAdvance],
  );

  const step = steps[stepIndex];
  const plan = step ? planFor(step) : null;

  // Load auto-advance preference.
  React.useEffect(() => {
    const v = localStorage.getItem("workout.autoAdvance");
    if (v != null) setAutoAdvance(v === "1");
  }, []);
  React.useEffect(() => {
    localStorage.setItem("workout.autoAdvance", autoAdvance ? "1" : "0");
  }, [autoAdvance]);

  // Mute preference — mirrored into a ref so the clock loop reads it live.
  React.useEffect(() => {
    const v = localStorage.getItem("workout.muted");
    if (v != null) setMuted(v === "1");
  }, []);
  React.useEffect(() => {
    mutedRef.current = muted;
    localStorage.setItem("workout.muted", muted ? "1" : "0");
  }, [muted]);

  // ── Cues ────────────────────────────────────────────────────────────────────
  // A single sine "beep". No-op when muted so all audio flows through one gate.
  const beep = React.useCallback((freq: number, dur: number, vol: number) => {
    const ctx = audioRef.current;
    if (!ctx || mutedRef.current) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.value = vol;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }, []);

  // Play one of the { freq, duration, volume } cues defined in RUN_CUES.
  const playBeep = React.useCallback(
    (b: { freq: number; duration: number; volume: number }) =>
      beep(b.freq, b.duration, b.volume),
    [beep],
  );

  // Distinct tones so each cue means one thing (all defined in RUN_CUES):
  const cueMarker = React.useCallback(
    () => playBeep(RUN_CUES.markerBeep),
    [playBeep],
  ); // 50%/25% blip
  const cueTick = React.useCallback(
    () => playBeep(RUN_CUES.countdownBeep),
    [playBeep],
  ); // 3-2-1 countdown
  const tickBeep = React.useCallback(
    () => playBeep(RUN_CUES.repBeep),
    [playBeep],
  ); // between reps

  // Terminal cue: "go" (a rest/get-ready ended → work starts) rises; "done" (a
  // timed set ended) is a firm single tone + green flash. Both distinct from the
  // countdown ticks and each other.
  const terminalAlert = React.useCallback(
    (kind: "go" | "done") => {
      if (kind === "go") {
        playBeep(RUN_CUES.goBeep);
        setTimeout(() => playBeep(RUN_CUES.goBeep2), RUN_CUES.goBeep2DelayMs);
        navigator.vibrate?.(RUN_CUES.vibrateMs.go);
      } else {
        playBeep(RUN_CUES.doneBeep);
        setFlash(true);
        setTimeout(() => setFlash(false), RUN_CUES.flashMs);
        navigator.vibrate?.(RUN_CUES.vibrateMs.done);
      }
    },
    [playBeep],
  );

  // ── Wake lock ─────────────────────────────────────────────────────────────
  const acquireWake = React.useCallback(async () => {
    try {
      wakeRef.current = await navigator.wakeLock?.request("screen");
    } catch {
      /* not supported / denied — fine */
    }
  }, []);
  React.useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && started && !done)
        acquireWake();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      wakeRef.current?.release().catch(() => {});
      wakeRef.current = null;
    };
  }, [started, done, acquireWake]);

  // ── Step init ─────────────────────────────────────────────────────────────
  const initStep = React.useCallback(
    (idx: number) => {
      const s = steps[idx];
      if (!s) return;
      const p = planFor(s);
      setFinished(false);
      setAwaitingStart(false);
      holdBeepedRef.current = false;
      cuesRef.current = {
        half: false,
        quarter: false,
        cd3: false,
        cd2: false,
        cd1: false,
      };
      // Start on a random tip (then it rotates while the step runs).
      const t = s.kind === "work" ? parseTips(s.item.tips) : [];
      setTipIndex(t.length ? Math.floor(Math.random() * t.length) : 0);
      // A rest timer always auto-runs; a WORK timer waits for a Start tap in
      // manual mode (nothing auto-starts when you're driving it yourself).
      const autoRun = p.type === "timer" && p.label === "rest" ? true : autoAdvance;
      if (p.type === "manual") {
        setRunning(false);
        setRemaining(0);
        setRep(0);
        repRef.current = 0;
      } else if (p.type === "timer") {
        setRep(0);
        repRef.current = 0;
        setRemaining(p.total);
        if (autoRun) {
          deadlineRef.current = Date.now() + p.total * 1000;
          setRunning(true);
        } else {
          setRunning(false);
          setAwaitingStart(true);
        }
      } else {
        setRep(1);
        repRef.current = 1;
        const d = repDuration(p, 1);
        setRemaining(d);
        if (autoRun) {
          deadlineRef.current = Date.now() + d * 1000;
          setRunning(true);
        } else {
          setRunning(false);
          setAwaitingStart(true);
        }
      }
    },
    [steps, autoAdvance],
  );

  React.useEffect(() => {
    if (started && !done) {
      initStep(stepIndex);
      anchorKeyRef.current = anchorKey(steps, stepIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, started, autoAdvance]);

  // Flipping auto-advance rebuilds `steps` (lead-ins appear/disappear), so the
  // re-anchored index must land in the same update or a render indexes past the end.
  const toggleAutoAdvance = (next: boolean) => {
    if (started && !done) {
      const nextSteps = buildSteps(items, rounds, restBetweenRounds, {
        autoAdvance: next,
      });
      const key = anchorKeyRef.current;
      const target = key
        ? nextSteps.findIndex((_, i) => stepKey(nextSteps, i) === key)
        : -1;
      setStepIndex(
        target >= 0 ? target : Math.min(stepIndex, nextSteps.length - 1),
      );
    }
    setAutoAdvance(next);
  };

  // ── Advance ─────────────────────────────────────────────────────────────────
  const advance = React.useCallback(() => {
    if (stepIndex + 1 >= steps.length) {
      setDone(true);
      wakeRef.current?.release().catch(() => {});
    } else {
      setStepIndex(stepIndex + 1);
    }
  }, [stepIndex, steps.length]);

  // ── Rotating tip (cadence set by RUN_TIMING.tipRotateSeconds) ────────────────
  const tips = step && step.kind === "work" ? parseTips(step.item.tips) : [];
  React.useEffect(() => {
    if (tips.length <= 1 || !running) return;
    const id = setInterval(
      () => setTipIndex((t) => (t + 1) % tips.length),
      RUN_TIMING.tipRotateSeconds * 1000,
    );
    return () => clearInterval(id);
  }, [tips.length, running, stepIndex]);

  // ── The clock ───────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!started || done || !running || !plan || plan.type === "manual") return;
    const id = setInterval(() => {
      const rem = (deadlineRef.current - Date.now()) / 1000;
      // Entering the HOLD (second half of the final rep) — cue it once.
      // Cue the HOLD when the final rep reaches the top (build half done).
      if (
        plan.type === "repsTimed" &&
        plan.holdLast &&
        repRef.current === plan.reps &&
        rem <= plan.per * (0.5 + RUN_TIMING.holdRatio) &&
        rem > 0.05 &&
        !holdBeepedRef.current
      ) {
        holdBeepedRef.current = true;
        playBeep(RUN_CUES.holdBeep);
        navigator.vibrate?.(RUN_CUES.vibrateMs.hold);
      }
      if (rem > 0.05) {
        // Timer cues: progress markers (timed WORK holds only) + a 3-2-1
        // countdown (every timer). repsTimed keeps only its per-rep tick.
        if (plan.type === "timer") {
          const total = plan.total;
          const c = cuesRef.current;
          // Halfway / quarter blips — only on real holds, long enough, and never
          // inside the last ~3.5s where they'd collide with the countdown.
          if (plan.label === "work" && total >= 12) {
            if (rem <= total * 0.5 && rem > 3.5 && !c.half) {
              c.half = true;
              cueMarker();
            }
            if (rem <= total * 0.25 && rem > 3.5 && !c.quarter) {
              c.quarter = true;
              cueMarker();
            }
          }
          // 3-2-1 countdown (skip on very short timers so it isn't a blur).
          if (total > 3.5) {
            if (rem <= 3 && !c.cd3) {
              c.cd3 = true;
              cueTick();
            }
            if (rem <= 2 && !c.cd2) {
              c.cd2 = true;
              cueTick();
            }
            if (rem <= 1 && !c.cd1) {
              c.cd1 = true;
              cueTick();
            }
          }
        }
        setRemaining(rem);
        return;
      }
      // phase ended
      if (plan.type === "repsTimed" && repRef.current < plan.reps) {
        repRef.current += 1;
        setRep(repRef.current);
        holdBeepedRef.current = false;
        const d = repDuration(plan, repRef.current);
        deadlineRef.current = Date.now() + d * 1000;
        setRemaining(d);
        tickBeep();
      } else {
        // "GO" when a rest/get-ready ends (work resumes); "done" when a set ends.
        terminalAlert(plan.type === "timer" && plan.label === "rest" ? "go" : "done");
        if (autoAdvance) advance();
        else {
          setFinished(true);
          setRunning(false);
          setRemaining(0);
        }
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, done, running, stepIndex, autoAdvance]);

  // ── Controls ────────────────────────────────────────────────────────────────
  async function start() {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioRef.current = new Ctx();
      await audioRef.current.resume();
    } catch {
      /* audio not available */
    }
    acquireWake();
    setStarted(true);
  }

  // Start a timed WORK step that's been sitting on its Start button (manual mode).
  function beginTimer() {
    if (!plan || plan.type === "manual") return;
    deadlineRef.current = Date.now() + remaining * 1000;
    setAwaitingStart(false);
    setRunning(true);
  }

  function centerTap() {
    if (!plan || plan.type === "manual") return; // manual advances via button
    if (finished) {
      advance();
      return;
    }
    if (awaitingStart) {
      beginTimer();
      return;
    }
    if (running) setRunning(false);
    else {
      deadlineRef.current = Date.now() + remaining * 1000;
      setRunning(true);
    }
  }

  function prev() {
    setStepIndex((i) => Math.max(0, i - 1));
  }
  function restart() {
    initStep(stepIndex);
  }
  const exit = () => router.push(`/workout/${workoutId}`);

  // ── Empty / completion screens ────────────────────────────────────────────
  if (steps.length === 0) {
    return (
      <Screen>
        <Typography variant="h5" sx={{ mb: 2 }}>
          This workout has no exercises yet.
        </Typography>
        <Button variant="contained" onClick={exit}>
          Back to workout
        </Button>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <FitnessCenterIcon color="primary" sx={{ fontSize: 64, mb: 1 }} />
        <Typography variant="h3" component="h1" sx={{ mb: 1 }}>
          Nice work! 💪
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 4 }}>
          {workoutName} — done.
        </Typography>
        <Stack direction="row" spacing={1.5}>
          <Button variant="contained" onClick={exit}>
            Back to workout
          </Button>
          <Button variant="outlined" onClick={() => router.push("/workout")}>
            Home
          </Button>
        </Stack>
      </Screen>
    );
  }

  if (!started) {
    const first = steps.find((s) => s.kind === "work");
    return (
      <Screen>
        <Typography variant="overline" color="text.secondary">
          {steps.length} steps
        </Typography>
        <Typography variant="h3" component="h1" sx={{ mb: 1 }}>
          {workoutName}
        </Typography>
        {first && first.kind === "work" ? (
          <Typography color="text.secondary" sx={{ mb: 4 }}>
            First up: {first.item.name}
          </Typography>
        ) : null}
        <Button
          variant="contained"
          size="large"
          startIcon={<PlayArrowIcon />}
          onClick={start}
          sx={{ px: 5, py: 1.5, fontSize: "1.1rem" }}
        >
          Start
        </Button>
        <Button variant="text" color="inherit" onClick={exit} sx={{ mt: 2 }}>
          Cancel
        </Button>
      </Screen>
    );
  }

  // ── Active step ─────────────────────────────────────────────────────────────
  const isRest = step.kind === "rest";
  const restLabel = step.kind === "rest" ? step.label : "Rest";
  const item = step.kind === "work" ? step.item : null;
  // Rest reads as a calm neutral; work steps wear the profile accent.
  // Then an "almost done" ramp overrides it: yellow in the last 25%, red in the
  // last 10%. For timers that's by time; for auto-timed reps it's by rep number
  // (so it never flips colour mid-rep). Pure manual reps have no progress → no ramp.
  let color = isRest
    ? "var(--mui-palette-text-secondary)"
    : "var(--mui-palette-primary-main)";
  let zone: "yellow" | "red" | null = null;
  if (plan?.type === "timer") {
    const fracLeft = plan.total > 0 ? remaining / plan.total : 0;
    zone = fracLeft <= 0.1 ? "red" : fracLeft <= 0.25 ? "yellow" : null;
  } else if (plan?.type === "repsTimed") {
    const leftIncl = plan.reps - rep + 1; // reps remaining incl. the current one
    const redAt = Math.max(1, Math.round(plan.reps * 0.1));
    const yellowAt = Math.max(1, Math.round(plan.reps * 0.25));
    zone = leftIncl <= redAt ? "red" : leftIncl <= yellowAt ? "yellow" : null;
  }
  if (zone === "red") color = "var(--mui-palette-error-main)";
  else if (zone === "yellow") color = "var(--mui-palette-warning-main)";

  // dial fraction (outer ring) + inner breath disc + center content
  let fraction = 1;
  let inner: number | undefined = undefined;
  let hold = false;
  let center: React.ReactNode = null;
  if (plan?.type === "timer") {
    fraction = plan.total > 0 ? remaining / plan.total : 0;
    center = (
      <>
        <Typography sx={{ fontSize: "3.2rem", fontWeight: 800, lineHeight: 1 }}>
          {clock(remaining)}
        </Typography>
        {isRest ? (
          <Typography color="text.secondary">{restLabel}</Typography>
        ) : null}
      </>
    );
  } else if (plan?.type === "repsTimed") {
    const repDur = repDuration(plan, rep);
    const elapsed = Math.max(0, repDur - remaining);
    const isLastHold = plan.holdLast && rep === plan.reps;
    // Breath peaks at the MIDPOINT (the top / hardest point of the movement).
    // Normal rep: build (half) → fall (half), peaking at 50%.
    // Hold rep: build (half) → HOLD at the top (per × holdRatio) → fall (half).
    let intensity: number;
    if (isLastHold) {
      const half = plan.per / 2;
      const holdDur = plan.per * RUN_TIMING.holdRatio;
      if (elapsed < half) {
        intensity = Math.sin((elapsed / half) * (Math.PI / 2)); // build → peak
        hold = false;
      } else if (elapsed < half + holdDur) {
        intensity = 1; // HOLD at the top
        hold = true;
      } else {
        const fp = Math.min(1, (elapsed - half - holdDur) / half);
        intensity = Math.cos(fp * (Math.PI / 2)); // fall from the top
        hold = false;
      }
    } else {
      intensity = Math.sin((elapsed / plan.per) * Math.PI); // build → peak → fall
    }
    inner = Math.max(0, Math.min(1, intensity));
    // Outer ring = overall set progress (monotonic across reps).
    fraction = Math.min(1, (rep - 1 + elapsed / repDur) / plan.reps);
    center = hold ? (
      <Typography sx={{ fontSize: "3rem", fontWeight: 800, letterSpacing: 2 }}>
        HOLD
      </Typography>
    ) : (
      <>
        <Typography sx={{ fontSize: "4rem", fontWeight: 800, lineHeight: 1 }}>
          {rep}
        </Typography>
        <Typography color="text.secondary">of {plan.reps} reps</Typography>
      </>
    );
  } else {
    // manual
    fraction = 1;
    center = (
      <>
        <Typography
          sx={{ fontSize: "3rem", fontWeight: 800, lineHeight: 1.05 }}
        >
          {plan?.repsText ?? "Go"}
        </Typography>
        {plan?.repsText ? (
          <Typography color="text.secondary">reps</Typography>
        ) : null}
      </>
    );
  }

  // "Up next"
  const nextWork = steps.slice(stepIndex + 1).find((s) => s.kind === "work") as
    | Extract<RunStep, { kind: "work" }>
    | undefined;
  // Lead-ins are skipped, but the between-rounds "Rest" is worth announcing.
  const upNext = steps
    .slice(stepIndex + 1)
    .find((s) => s.kind === "work" || s.label === "Rest");

  const header =
    step.kind === "work" && step.round
      ? `${sectionLabel(step.item.section)} · Round ${step.round} of ${step.totalRounds}`
      : step.kind === "work"
        ? sectionLabel(step.item.section)
        : restLabel;

  const tip = tips.length ? tips[tipIndex % tips.length] : null;
  // A "lead-in" is a short gap that features what's coming up (auto mode only):
  // "Get ready" before an exercise, or "Switch" between the two sides of one.
  const isLeadIn =
    step.kind === "rest" &&
    (step.label === "Get ready" || step.label === "Switch");
  const leadInLabel =
    step.kind === "rest" && step.label === "Switch"
      ? "Switch sides"
      : "Get ready";
  // During a lead-in, feature the exercise/side you're getting ready for.
  const featured = isLeadIn && nextWork ? nextWork.item : item;
  const featuredSide =
    step.kind === "work"
      ? step.side
      : isLeadIn && nextWork
        ? nextWork.side
        : undefined;

  return (
    // Full-viewport overlay (covers the app header) so the active workout fills
    // the screen and never scrolls.
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        bgcolor: "background.default",
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: 520,
          height: "100dvh",
          display: "flex",
          flexDirection: "column",
          p: { xs: 2, sm: 3 },
        }}
      >
      {/* Top bar */}
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <FormControlLabel
          control={
            <Switch
              checked={autoAdvance}
              onChange={(e) => toggleAutoAdvance(e.target.checked)}
              size="small"
            />
          }
          label={<Typography variant="caption">Auto-advance</Typography>}
          sx={{ ml: 0 }}
        />
        <Stack direction="row" alignItems="center">
          <IconButton
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute cues" : "Mute cues"}
          >
            {muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
          </IconButton>
          <IconButton onClick={exit} aria-label="Exit workout">
            <CloseIcon />
          </IconButton>
        </Stack>
      </Stack>

      <LinearProgress
        variant="determinate"
        value={((stepIndex + 1) / steps.length) * 100}
        sx={{ height: 6, borderRadius: 1, mb: 1 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
        {header} · step {stepIndex + 1}/{steps.length}
      </Typography>

      {/* Name + info (during a lead-in gap, feature what's coming up) */}
      {isLeadIn ? (
        <Typography
          variant="overline"
          color="primary"
          textAlign="center"
          sx={{ display: "block" }}
        >
          {leadInLabel}
        </Typography>
      ) : null}
      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        justifyContent="center"
        sx={{ mb: 0.5 }}
      >
        <Typography variant="h4" component="h1" textAlign="center">
          {featured ? featured.name : restLabel}
        </Typography>
        {featured ? (
          <ExerciseInfoButton
            name={featured.name}
            description={featured.description}
            size="medium"
          />
        ) : null}
      </Stack>
      {/* Per-side badge (split squats, planks each side, …) */}
      {featuredSide ? (
        <Typography
          variant="subtitle2"
          color="primary"
          textAlign="center"
          sx={{ fontWeight: 700, mb: 0.5 }}
        >
          {featuredSide.label}
        </Typography>
      ) : null}
      {featured?.weight ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mb: 1 }}>
          {featured.weight}
        </Typography>
      ) : null}

      {/* Dial */}
      <Box
        sx={{
          flexGrow: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          my: 2,
        }}
      >
        <Dial
          fraction={fraction}
          inner={inner}
          color={color}
          hold={hold}
          flash={flash}
          onClick={centerTap}
        >
          {center}
        </Dial>
      </Box>

      {/* Tip (live only). Fixed height (≈2 lines, centered) so a longer tip when
          it rotates never shifts the "Up next" line or the action button below. */}
      {tip ? (
        <Box
          sx={{
            mb: 1,
            height: "3em", // 2 lines at lineHeight 1.5 — reserved, doesn't grow
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography
            color="text.secondary"
            textAlign="center"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            💡 {tip}
          </Typography>
        </Box>
      ) : null}

      {/* Up next (skip during a lead-in — the name is already featured above) */}
      {upNext && !isLeadIn ? (
        <Typography
          variant="body2"
          color="text.secondary"
          textAlign="center"
          sx={{ mb: 2 }}
        >
          Up next:{" "}
          {upNext.kind === "work"
            ? upNext.item.name
            : `Rest (${formatDuration(upNext.seconds)})`}
        </Typography>
      ) : null}

      {/* Primary action */}
      {plan?.type === "manual" ? (
        <Button
          variant="contained"
          size="large"
          startIcon={<CheckIcon />}
          onClick={advance}
          sx={{ py: 1.5, fontSize: "1.1rem", mb: 1 }}
        >
          Done → Next
        </Button>
      ) : awaitingStart ? (
        <Button
          variant="contained"
          size="large"
          startIcon={<PlayArrowIcon />}
          onClick={beginTimer}
          sx={{ py: 1.5, fontSize: "1.1rem", mb: 1 }}
        >
          Start
        </Button>
      ) : finished ? (
        <Button
          variant="contained"
          size="large"
          startIcon={<SkipNextIcon />}
          onClick={advance}
          sx={{ py: 1.5, fontSize: "1.1rem", mb: 1 }}
        >
          Next
        </Button>
      ) : isRest ? (
        <Button
          variant="outlined"
          size="large"
          startIcon={<SkipNextIcon />}
          onClick={advance}
          sx={{ py: 1.5, fontSize: "1.05rem", mb: 1 }}
        >
          Skip{restLabel === "Rest" ? " rest" : ""}
        </Button>
      ) : null}

      {/* Controls */}
      <Stack direction="row" justifyContent="center" spacing={1}>
        <IconButton
          onClick={prev}
          disabled={stepIndex === 0}
          aria-label="Previous"
        >
          <SkipPreviousIcon />
        </IconButton>
        {plan?.type !== "manual" ? (
          <IconButton
            onClick={centerTap}
            aria-label={running ? "Pause" : "Resume"}
          >
            {running ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
        ) : null}
        <IconButton onClick={restart} aria-label="Restart step">
          <ReplayIcon />
        </IconButton>
        <IconButton onClick={advance} aria-label="Skip">
          <SkipNextIcon />
        </IconButton>
      </Stack>
      </Box>
    </Box>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1300,
        bgcolor: "background.default",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        p: 3,
      }}
    >
      {children}
    </Box>
  );
}
