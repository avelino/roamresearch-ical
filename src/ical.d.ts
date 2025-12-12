declare module "ical.js" {
  export function parse(input: string): unknown[];

  export class Component {
    constructor(jcal: unknown[] | string);
    getFirstPropertyValue(name: string): unknown;
    getAllSubcomponents(name: string): Component[];
  }

  export class Event {
    constructor(component: Component);
    uid: string;
    summary: string;
    description: string;
    location: string;
    startDate: Time | null;
    endDate: Time | null;
  }

  export class Time {
    toJSDate(): Date;
  }
}
