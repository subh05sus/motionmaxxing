// From the apple-glass design kit.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/motion";

/**
 * Drives the spinner -> check pattern for buttons that wait on the server
 * (`<Button loading={loading} success={success}>`). `run` ignores repeat
 * calls while one is in flight, so a double tap can never fire twice.
 * `success` stays true for ~1.2s after the action resolves.
 */
export function useAsyncAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
  { successMs = 1200 }: { successMs?: number } = {},
) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const inFlight = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const run = useCallback(
    async (...args: Args): Promise<Result | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setLoading(true);
      setSuccess(false);
      try {
        const result = await actionRef.current(...args);
        setSuccess(true);
        haptic("success");
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setSuccess(false), successMs);
        return result;
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [successMs],
  );

  return { run, loading, success };
}
