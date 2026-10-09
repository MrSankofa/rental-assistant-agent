import { properties } from "../data/properties";
import { availability } from "../data/showingAvailability";
// todo brett: currently WIP, doesn't account for exceptions or previous bookings.

export type Property = {
  name: string,
  available: boolean,
  rent: number,
  bedrooms: number,
  bathrooms: number,
  utilitiesIncluded: boolean,
  parking: string,
  leaseTerm: string,
  applicationUrl: string,
}
export type PropertyInfoResponse = {
  found: boolean,
  message?: string
  property?: Property
}

export type ShowingAvailabilityResponse = {
  found: boolean,
  message?: string,
  availableSlots: string[]
}
export interface TimeSlot {
  availableStart: string; // "HH:mm:ss" format
  availableEnd: string;   // "HH:mm:ss" format
}

export interface ScheduleException {
  start: string; // ISO 8601 string without offset (e.g., "YYYY-MM-DDTHH:mm:ss")
  end: string;   // ISO 8601 string without offset
}

export interface WeeklySchedule {
  sunday?: TimeSlot;
  monday?: TimeSlot;
  tuesday?: TimeSlot;
  wednesday?: TimeSlot;
  thursday?: TimeSlot;
  friday?: TimeSlot;
  saturday?: TimeSlot;
}

export interface SchedulingConfig {
  timezone: string;
  activeFrom: string; // "YYYY-MM-DD" format
  activeUntil: string; // "YYYY-MM-DD" format
  slotDurationMinutes: number;
  exceptions: ScheduleException[];
  weeklySchedule: WeeklySchedule;
}

export function getPropertyInformation(propertyId: string): PropertyInfoResponse {
  const property = properties[propertyId as keyof typeof properties];

  if (!property) {
    return {
      found: false,
      message: "Property not found",
    };
  }

  return {
    found: true,
    property,
  };
}


// targetDate: 2026-10-10
export function getShowingAvailability(propertyId: string, targetDate: string): ShowingAvailabilityResponse {

  const getResponse = getPropertyInformation(propertyId);

  if (!getResponse.found) {
    return {
      found: false,
      message: getResponse.message,
      availableSlots: []
    }
  }

  const propertyAvailability: SchedulingConfig = availability[propertyId as keyof typeof availability];

  if (!propertyAvailability) {
    return {
      found: false,
      message: `We do not have a schedule for this property ${propertyId}`,
      availableSlots: []
    }
  }

  // figure out if the target date is in the active window

  const isWithinActiveRange =
    targetDate >= propertyAvailability.activeFrom &&
    targetDate <= propertyAvailability.activeUntil;

  if (!isWithinActiveRange) {
    return {
      found: true,
      message: "No showing availability for this date",
      availableSlots: []
    };
  }

  const dayOfWeek = getDayOfWeek(targetDate);
  const dailySchedule =
    propertyAvailability.weeklySchedule[dayOfWeek];

  if (!dailySchedule) {
    return {
      found: true,
      message: "No showings are scheduled for this day",
      availableSlots: []
    };
  }

  const availableSlots: string[] = [];


  const availSlotTimeStrStart = dailySchedule.availableStart;
  const availSlotTimeStrEnd = dailySchedule.availableEnd;

  let availSlotTimeStartNum = timeToMinutes(availSlotTimeStrStart)
  let availSlotTimeEndNum = timeToMinutes(availSlotTimeStrEnd)

  // figure out how many slots are available
  while (availSlotTimeStartNum < availSlotTimeEndNum) {
    availableSlots.push(numberToTimeStr(availSlotTimeStartNum));
    availSlotTimeStartNum += propertyAvailability.slotDurationMinutes;
  }
  // return the object
  if (availableSlots.length === 0) {
    return {
      found: true,
      message: "No Available slots",
      availableSlots
    }
  }


  return {
    found: true,
    message: "Available time slots found",
    availableSlots: availableSlots
  };

}

function timeToMinutes(timeStr: string): number {
  const [hours, minutes, seconds] = timeStr.split(":").map(Number);

  return (hours * 60) + minutes;
}

function numberToTimeStr(timeNum: number): string {
  // Ensure we don't exceed 24 hours
  const boundedMinutes = timeNum % 1440;

  const hours = Math.floor(boundedMinutes / 60);
  const minutes = boundedMinutes % 60;

  // Pad with leading zeros to guarantee clean string comparisons later
  const hStr = String(hours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');

  return `${hStr}:${mStr}:00`;
}

type DayOfWeek = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

function getDayOfWeek(dateStr: string): DayOfWeek {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // Split the YYYY-MM-DD string into components
  const [year, month, day] = dateStr.split('-').map(Number);

  // Note: JavaScript months are 0-indexed (January is 0, October is 9)
  const date = new Date(year, month - 1, day);

  return days[date.getDay()];
}
