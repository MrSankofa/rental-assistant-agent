export interface ShowingAvailabilityResponse {
  found: boolean;
  message?: string;
  availableSlots: string[];
}

export interface TimeSlot {
  availableStart: string;
  availableEnd: string;
}

export interface ScheduleException {
  start: string;
  end: string;
}

export type DayOfWeek =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export type WeeklySchedule = Partial<Record<DayOfWeek, TimeSlot>>;

export interface SchedulingConfig {
  timezone: string;
  activeFrom: string;
  activeUntil: string;
  slotDurationMinutes: number;
  exceptions: ScheduleException[];
  weeklySchedule: WeeklySchedule;
}
