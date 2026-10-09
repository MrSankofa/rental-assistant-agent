import { properties } from "../data/properties";
import { availability } from "../data/showingAvailability";
import { PropertyInfoResponse } from "../types/property";
import { ShowingAvailabilityResponse, SchedulingConfig, ScheduleException } from "../types/scheduling";
import { timeToMinutes, numberToTimeStr, getDayOfWeek } from "../helpers/helpers";

// todo brett: currently WIP, doesn't account for exceptions or previous bookings.
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


// targetDate: 2026-10-10, propertyId: virginia
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


