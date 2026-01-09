declare module "ical.js" {
  export function parse(input: string): unknown[];

  export class Component {
    constructor(jcal: unknown[] | string);
    getFirstPropertyValue(name: string): unknown;
    getFirstProperty(name: string): Property | null;
    getAllSubcomponents(name: string): Component[];
  }

  export class Property {
    getParameter(name: string): string | null;
    getValues(): unknown[];
    jCal: unknown[];
  }

  export class Event {
    constructor(component: Component);
    uid: string;
    summary: string;
    description: string;
    location: string;
    startDate: Time | null;
    endDate: Time | null;
    attendees: Property[];
    /** Checks if the event has recurrence rules (RRULE) */
    isRecurring(): boolean;
  }

  export class Time {
    toJSDate(): Date;
    /** True if this is a DATE value (all-day event), false if DATE-TIME */
    isDate: boolean;
    /** IANA timezone identifier (e.g., "America/New_York") or null */
    timezone: string | null;
  }
}
