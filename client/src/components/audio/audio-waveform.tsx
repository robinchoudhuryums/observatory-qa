/**
 * Audio Waveform Display — canvas-based amplitude visualization with click-to-seek.
 *
 * Adapted from the Call Analyzer for Observatory QA. Uses Web Audio API to decode
 * audio and render a normalized amplitude waveform. Falls back gracefully if the
 * audio format can't be decoded.
 */
import { useRef, useEffect, useState, useCallback } from "react";

interface AudioWaveformProps {
  /** URL to the audio file */
  audioUrl: string;
  /** Current playback position in seconds */
  currentTime?: number;
  /** Total duration in seconds */
  duration?: number;
  /** Callback when user clicks on waveform to seek */
  onSeek?: (timeSeconds: number) => void;
  /** Number of bars to render (default 200) */
  barCount?: number;
  /** Height in pixels (default 80) */
  height?: number;
  /** Color for played portion */
  playedColor?: string;
  /** Color for unplayed portion */
  unplayedColor?: string;
}

export function AudioWaveform({
  audioUrl,
  currentTime = 0,
  duration = 0,
  onSeek,
  barCount = 200,
  height = 80,
  playedColor = "hsl(var(--primary))",
  unplayedColor = "hsl(var(--muted-foreground) / 0.3)",
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [amplitudes, setAmplitudes] = useState<number[]>([]);
  const [error, setError] = useState(false);

  // Decode audio and extract amplitude peaks
  useEffect(() => {
    if (!audioUrl) return;

    let cancelled = false;
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    fetch(audioUrl)
      .then((res) => res.arrayBuffer())
      .then((buffer) => audioContext.decodeAudioData(buffer))
      .then((decoded) => {
        if (cancelled) return;
        const channelData = decoded.getChannelData(0);
        const samplesPerBar = Math.floor(channelData.length / barCount);
        const peaks: number[] = [];

        for (let i = 0; i < barCount; i++) {
          let maxAmplitude = 0;
          const start = i * samplesPerBar;
          const end = Math.min(start + samplesPerBar, channelData.length);
          for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]);
            if (abs > maxAmplitude) maxAmplitude = abs;
          }
          peaks.push(maxAmplitude);
        }

        // Normalize to 0-1 range
        const max = Math.max(...peaks, 0.01);
        setAmplitudes(peaks.map((p) => p / max));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        audioContext.close().catch(() => {});
      });

    return () => {
      cancelled = true;
    };
  }, [audioUrl, barCount]);

  // Render waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || amplitudes.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const barWidth = width / amplitudes.length;
    const playedFraction = duration > 0 ? currentTime / duration : 0;
    const playedBars = Math.floor(playedFraction * amplitudes.length);

    for (let i = 0; i < amplitudes.length; i++) {
      const barHeight = Math.max(2, amplitudes[i] * (height - 4));
      const x = i * barWidth;
      const y = (height - barHeight) / 2;

      ctx.fillStyle = i < playedBars ? playedColor : unplayedColor;
      ctx.fillRect(x + 0.5, y, Math.max(1, barWidth - 1), barHeight);
    }
  }, [amplitudes, currentTime, duration, height, playedColor, unplayedColor]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onSeek || !duration || amplitudes.length === 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const fraction = clickX / rect.width;
      onSeek(fraction * duration);
    },
    [onSeek, duration, amplitudes],
  );

  if (error) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        Waveform unavailable
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="w-full cursor-pointer"
      style={{ height }}
      aria-label="Audio waveform — click to seek"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
    />
  );
}
