import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleAutoSync,
  cancelScheduledSync,
  getSchedulerStatus,
} from "../src/scheduler";

describe("scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Ensure clean state before each test
    cancelScheduledSync();
  });

  afterEach(() => {
    cancelScheduledSync();
    vi.useRealTimers();
  });

  describe("scheduleAutoSync", () => {
    it("should schedule sync at specified interval", () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      scheduleAutoSync(handler, 1000);

      expect(getSchedulerStatus().active).toBe(true);
      expect(getSchedulerStatus().intervalMs).toBe(1000);
    });

    it("should call handler after interval elapses", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      scheduleAutoSync(handler, 1000);

      // Handler should not be called immediately
      expect(handler).not.toHaveBeenCalled();

      // Advance time by interval
      await vi.advanceTimersByTimeAsync(1000);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should call handler repeatedly at interval", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      scheduleAutoSync(handler, 500);

      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("should not call handler if interval is invalid", () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      scheduleAutoSync(handler, undefined);
      expect(getSchedulerStatus().active).toBe(false);

      scheduleAutoSync(handler, 0);
      expect(getSchedulerStatus().active).toBe(false);

      scheduleAutoSync(handler, -1000);
      expect(getSchedulerStatus().active).toBe(false);

      scheduleAutoSync(handler, NaN);
      expect(getSchedulerStatus().active).toBe(false);
    });

    it("should cancel previous schedule when called again", async () => {
      const handler1 = vi.fn().mockResolvedValue(undefined);
      const handler2 = vi.fn().mockResolvedValue(undefined);

      scheduleAutoSync(handler1, 1000);
      scheduleAutoSync(handler2, 2000);

      expect(getSchedulerStatus().intervalMs).toBe(2000);

      await vi.advanceTimersByTimeAsync(1000);
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should skip tick if previous sync is still running", async () => {
      let resolveFirst: () => void = () => {};
      const firstPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const handler = vi.fn().mockImplementation(() => firstPromise);
      scheduleAutoSync(handler, 500);

      // First tick - starts first sync
      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(1);

      // Second tick - should be skipped because first sync is running
      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(1);

      // Complete first sync
      resolveFirst();
      await Promise.resolve();

      // Third tick - should run because sync is no longer running
      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("should not reschedule if same handler and interval", () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      scheduleAutoSync(handler, 1000);
      const status1 = getSchedulerStatus();

      scheduleAutoSync(handler, 1000);
      const status2 = getSchedulerStatus();

      expect(status1.active).toBe(true);
      expect(status2.active).toBe(true);
      expect(status1.intervalMs).toBe(status2.intervalMs);
    });
  });

  describe("cancelScheduledSync", () => {
    it("should cancel active schedule", () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      scheduleAutoSync(handler, 1000);

      expect(getSchedulerStatus().active).toBe(true);

      cancelScheduledSync();

      expect(getSchedulerStatus().active).toBe(false);
      expect(getSchedulerStatus().intervalMs).toBeNull();
    });

    it("should be safe to call multiple times", () => {
      expect(() => {
        cancelScheduledSync();
        cancelScheduledSync();
        cancelScheduledSync();
      }).not.toThrow();
    });

    it("should prevent further handler calls", async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      scheduleAutoSync(handler, 500);

      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(1);

      cancelScheduledSync();

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("getSchedulerStatus", () => {
    it("should return inactive status when not scheduled", () => {
      const status = getSchedulerStatus();

      expect(status.active).toBe(false);
      expect(status.intervalMs).toBeNull();
    });

    it("should return active status with interval when scheduled", () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      scheduleAutoSync(handler, 5000);

      const status = getSchedulerStatus();

      expect(status.active).toBe(true);
      expect(status.intervalMs).toBe(5000);
    });
  });
});
