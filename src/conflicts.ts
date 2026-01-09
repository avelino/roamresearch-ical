/**
 * Conflict detection for calendar events.
 * Identifies overlapping events that may represent scheduling conflicts.
 */

import type { ICalEvent } from "./ical";

/**
 * Configuration for conflict detection.
 */
export interface ConflictDetectionConfig {
  /** Whether conflict detection is enabled */
  enabled: boolean;
  /** Exclude all-day events from conflict detection */
  excludeAllDay: boolean;
  /** Minimum overlap in minutes to count as a conflict */
  minimumOverlapMinutes: number;
}

/**
 * Default configuration for conflict detection.
 */
export const DEFAULT_CONFLICT_CONFIG: ConflictDetectionConfig = {
  enabled: false,
  excludeAllDay: true,
  minimumOverlapMinutes: 15,
};

/**
 * A group of events that conflict with each other.
 */
export interface ConflictGroup {
  /** Events that overlap */
  events: ICalEvent[];
  /** The overlapping time slot */
  timeSlot: {
    start: Date;
    end: Date;
  };
}

/**
 * Result from conflict detection.
 */
export interface ConflictDetectionResult {
  /** Groups of conflicting events */
  conflicts: ConflictGroup[];
  /** UIDs of all events involved in conflicts */
  conflictingEventUids: Set<string>;
  /** Total number of conflicts found */
  totalConflicts: number;
}

/**
 * Checks if two events overlap by at least the minimum overlap time.
 *
 * @param a First event.
 * @param b Second event.
 * @param minOverlapMs Minimum overlap in milliseconds.
 * @returns True if events overlap by at least minOverlapMs.
 */
export function eventsOverlap(
  a: ICalEvent,
  b: ICalEvent,
  minOverlapMs: number
): boolean {
  // Need both start and end times to check overlap
  if (!a.dtstart || !a.dtend || !b.dtstart || !b.dtend) {
    return false;
  }

  const aStart = a.dtstart.getTime();
  const aEnd = a.dtend.getTime();
  const bStart = b.dtstart.getTime();
  const bEnd = b.dtend.getTime();

  // Check for overlap
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);

  // If overlap exists and is at least minOverlapMs
  if (overlapStart < overlapEnd) {
    const overlapDuration = overlapEnd - overlapStart;
    return overlapDuration >= minOverlapMs;
  }

  return false;
}

/**
 * Calculates the overlapping time slot between two events.
 *
 * @param a First event.
 * @param b Second event.
 * @returns The overlapping time slot, or null if no overlap.
 */
function getOverlapSlot(
  a: ICalEvent,
  b: ICalEvent
): { start: Date; end: Date } | null {
  if (!a.dtstart || !a.dtend || !b.dtstart || !b.dtend) {
    return null;
  }

  const overlapStart = new Date(Math.max(a.dtstart.getTime(), b.dtstart.getTime()));
  const overlapEnd = new Date(Math.min(a.dtend.getTime(), b.dtend.getTime()));

  if (overlapStart < overlapEnd) {
    return { start: overlapStart, end: overlapEnd };
  }

  return null;
}

/**
 * Detects conflicts among a list of events using sweep line algorithm.
 * Time complexity: O(n log n) due to sorting.
 *
 * @param events Events to check for conflicts.
 * @param config Conflict detection configuration.
 * @returns Conflict detection result with groups and UIDs.
 */
export function detectConflicts(
  events: ICalEvent[],
  config: ConflictDetectionConfig
): ConflictDetectionResult {
  if (!config.enabled || events.length < 2) {
    return {
      conflicts: [],
      conflictingEventUids: new Set(),
      totalConflicts: 0,
    };
  }

  const minOverlapMs = config.minimumOverlapMinutes * 60 * 1000;

  // Filter events based on config
  const filteredEvents = events.filter((event) => {
    // Exclude all-day events if configured
    if (config.excludeAllDay && event.isAllDay) {
      return false;
    }

    // Need both start and end to detect conflicts
    if (!event.dtstart || !event.dtend) {
      return false;
    }

    return true;
  });

  // Sort events by start time
  const sortedEvents = [...filteredEvents].sort((a, b) => {
    return (a.dtstart?.getTime() ?? 0) - (b.dtstart?.getTime() ?? 0);
  });

  const conflicts: ConflictGroup[] = [];
  const conflictingEventUids = new Set<string>();
  const processedPairs = new Set<string>();

  // Sweep line algorithm
  for (let i = 0; i < sortedEvents.length; i++) {
    const eventA = sortedEvents[i];

    for (let j = i + 1; j < sortedEvents.length; j++) {
      const eventB = sortedEvents[j];

      // Optimization: if eventB starts after eventA ends, no more conflicts possible
      if (eventB.dtstart && eventA.dtend && eventB.dtstart >= eventA.dtend) {
        break;
      }

      // Skip if we've already processed this pair (by UID)
      const pairKey = [eventA.uid, eventB.uid].sort().join("|");
      if (processedPairs.has(pairKey)) {
        continue;
      }
      processedPairs.add(pairKey);

      // Check for overlap
      if (eventsOverlap(eventA, eventB, minOverlapMs)) {
        const timeSlot = getOverlapSlot(eventA, eventB);
        if (timeSlot) {
          conflicts.push({
            events: [eventA, eventB],
            timeSlot,
          });
          conflictingEventUids.add(eventA.uid);
          conflictingEventUids.add(eventB.uid);
        }
      }
    }
  }

  return {
    conflicts,
    conflictingEventUids,
    totalConflicts: conflicts.length,
  };
}

/**
 * Checks if a specific event is involved in any conflicts.
 *
 * @param event Event to check.
 * @param conflictingUids Set of UIDs involved in conflicts.
 * @returns True if the event is in a conflict.
 */
export function isEventInConflict(
  event: ICalEvent,
  conflictingUids: Set<string>
): boolean {
  return conflictingUids.has(event.uid);
}

/**
 * Groups all conflicts that share events (transitive conflicts).
 * For example, if A conflicts with B and B conflicts with C,
 * they would all be in one group.
 *
 * @param conflicts Individual conflict pairs.
 * @returns Merged conflict groups.
 */
export function mergeTransitiveConflicts(
  conflicts: ConflictGroup[]
): ConflictGroup[] {
  if (conflicts.length === 0) {
    return [];
  }

  // Use union-find to group events
  const parent = new Map<string, string>();

  const find = (uid: string): string => {
    if (!parent.has(uid)) {
      parent.set(uid, uid);
    }
    if (parent.get(uid) !== uid) {
      parent.set(uid, find(parent.get(uid)!));
    }
    return parent.get(uid)!;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  };

  // Union events that conflict
  for (const conflict of conflicts) {
    const uids = conflict.events.map((e) => e.uid);
    for (let i = 1; i < uids.length; i++) {
      union(uids[0], uids[i]);
    }
  }

  // Group events by root
  const groups = new Map<string, Set<ICalEvent>>();
  const groupTimeSlots = new Map<string, { start: Date; end: Date }>();

  for (const conflict of conflicts) {
    for (const event of conflict.events) {
      const root = find(event.uid);
      if (!groups.has(root)) {
        groups.set(root, new Set());
      }
      groups.get(root)!.add(event);

      // Track the overall time slot
      if (!groupTimeSlots.has(root)) {
        groupTimeSlots.set(root, { ...conflict.timeSlot });
      } else {
        const existing = groupTimeSlots.get(root)!;
        existing.start = new Date(Math.min(existing.start.getTime(), conflict.timeSlot.start.getTime()));
        existing.end = new Date(Math.max(existing.end.getTime(), conflict.timeSlot.end.getTime()));
      }
    }
  }

  // Convert to ConflictGroups
  const mergedGroups: ConflictGroup[] = [];
  for (const [root, eventSet] of groups.entries()) {
    mergedGroups.push({
      events: Array.from(eventSet),
      timeSlot: groupTimeSlots.get(root)!,
    });
  }

  return mergedGroups;
}

/**
 * Formats a conflict for display.
 *
 * @param conflict Conflict group to format.
 * @returns Human-readable conflict description.
 */
export function formatConflictDescription(conflict: ConflictGroup): string {
  const eventNames = conflict.events.map((e) => e.summary || "Untitled").join(" & ");
  const start = conflict.timeSlot.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const end = conflict.timeSlot.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${eventNames} (${start} - ${end})`;
}
