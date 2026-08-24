"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const WORK_SECONDS = 20 * 60;
const REST_SECONDS = 20;

type Phase = "work" | "rest";

function playChime(notes: number[]) {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioContextCtor();
  const noteDuration = 0.14;
  const gap = 0.03;
  notes.forEach((freq, i) => {
    const start = ctx.currentTime + i * (noteDuration + gap);
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = freq;
    gainNode.gain.setValueAtTime(0, start);
    gainNode.gain.linearRampToValueAtTime(0.35, start + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + noteDuration);
  });
  setTimeout(() => ctx.close(), (notes.length * (noteDuration + gap) + 0.2) * 1000);
}

// "ti-di-ri-ti" — a short four-note ascending chime.
const REST_CHIME = [880, 988, 1175, 1319];
// A shorter two-note chime for "back to work".
const WORK_CHIME = [1175, 880];

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function EyeTimerPage() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("work");
  const [remaining, setRemaining] = useState(WORK_SECONDS);
  const endTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;

    const tick = () => {
      if (endTimeRef.current === null) return;
      const secondsLeft = Math.ceil((endTimeRef.current - Date.now()) / 1000);
      if (secondsLeft > 0) {
        setRemaining(secondsLeft);
        return;
      }
      setPhase(prevPhase => {
        const nextPhase: Phase = prevPhase === "work" ? "rest" : "work";
        const nextDuration = nextPhase === "work" ? WORK_SECONDS : REST_SECONDS;
        playChime(nextPhase === "rest" ? REST_CHIME : WORK_CHIME);
        endTimeRef.current = Date.now() + nextDuration * 1000;
        setRemaining(nextDuration);
        return nextPhase;
      });
    };

    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [running]);

  const start = () => {
    endTimeRef.current = Date.now() + remaining * 1000;
    setRunning(true);
  };

  const pause = () => {
    setRunning(false);
    endTimeRef.current = null;
  };

  const reset = () => {
    setRunning(false);
    endTimeRef.current = null;
    setPhase("work");
    setRemaining(WORK_SECONDS);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Eye className="h-6 w-6 text-brand-700" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Eye Rest Timer</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The WHO&apos;s 20-20-20 rule: every 20 minutes, look at something 20 feet away for 20 seconds.
          </p>
        </div>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">
            {phase === "work" ? "Focus time" : "Look away!"}
          </CardTitle>
          <CardDescription>
            {phase === "work"
              ? "Screen time in progress. You'll hear a chime when it's time to rest your eyes."
              : "Look at something at least 20 feet (6m) away until the chime."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div
            className={`rounded-2xl border py-10 text-center ${
              phase === "rest" ? "border-brand-200 bg-brand-50" : "border-gray-200 bg-gray-50"
            }`}
          >
            <p className={`font-mono text-5xl font-bold ${phase === "rest" ? "text-brand-700" : "text-gray-900"}`}>
              {formatTime(remaining)}
            </p>
          </div>
          <div className="flex gap-2">
            {running ? (
              <Button type="button" className="flex-1 bg-brand-700 hover:bg-brand-800" onClick={pause}>
                <Pause className="mr-2 h-4 w-4" /> Pause
              </Button>
            ) : (
              <Button type="button" className="flex-1 bg-brand-700 hover:bg-brand-800" onClick={start}>
                <Play className="mr-2 h-4 w-4" /> Start
              </Button>
            )}
            <Button type="button" variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Keep this tab open in the background — the timer and chime keep running even while you work in another tab or window.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
