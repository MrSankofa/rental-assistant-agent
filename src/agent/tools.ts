import { properties } from "../data/properties";
import { availability } from "../data/showingAvailability";
import { PropertyInfoResponse } from "../types/property";
import { ShowingAvailabilityResponse, SchedulingConfig } from "../types/scheduling";
import { timeToMinutes, numberToTimeStr, getDayOfWeek, isSlotBlocked } from "../helpers/helpers";

// todo brett: currently WIP, doesn't account for previous bookings.
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
  const availSlotTimeEndNum = timeToMinutes(availSlotTimeStrEnd);
  
  while (availSlotTimeStartNum + propertyAvailability.slotDurationMinutes <= availSlotTimeEndNum) {
    const isBlocked = isSlotBlocked(propertyAvailability.exceptions, availSlotTimeStartNum, propertyAvailability.slotDurationMinutes, targetDate);

    if (!isBlocked) {
      availableSlots.push(numberToTimeStr(availSlotTimeStartNum));
    }

    availSlotTimeStartNum += propertyAvailability.slotDurationMinutes;
  }
  
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


