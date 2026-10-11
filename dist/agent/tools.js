"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShowingAvailability = exports.getPropertyInformation = void 0;
const properties_1 = require("../data/properties");
const showingAvailability_1 = require("../data/showingAvailability");
const helpers_1 = require("../helpers/helpers");
// todo brett: currently WIP, doesn't account for previous bookings.
function getPropertyInformation(propertyId) {
    const property = properties_1.properties[propertyId];
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
exports.getPropertyInformation = getPropertyInformation;
// targetDate: 2026-10-10, propertyId: virginia
function getShowingAvailability(propertyId, targetDate) {
    const getResponse = getPropertyInformation(propertyId);
    if (!getResponse.found) {
        return {
            found: false,
            message: getResponse.message,
            availableSlots: []
        };
    }
    const propertyAvailability = showingAvailability_1.availability[propertyId];
    if (!propertyAvailability) {
        return {
            found: false,
            message: `We do not have a schedule for this property ${propertyId}`,
            availableSlots: []
        };
    }
    const isWithinActiveRange = targetDate >= propertyAvailability.activeFrom &&
        targetDate <= propertyAvailability.activeUntil;
    if (!isWithinActiveRange) {
        return {
            found: true,
            message: "No showing availability for this date",
            availableSlots: []
        };
    }
    const dayOfWeek = (0, helpers_1.getDayOfWeek)(targetDate);
    const dailySchedule = propertyAvailability.weeklySchedule[dayOfWeek];
    if (!dailySchedule) {
        return {
            found: true,
            message: "No showings are scheduled for this day",
            availableSlots: []
        };
    }
    const availableSlots = [];
    const availSlotTimeStrStart = dailySchedule.availableStart;
    const availSlotTimeStrEnd = dailySchedule.availableEnd;
    let availSlotTimeStartNum = (0, helpers_1.timeToMinutes)(availSlotTimeStrStart);
    const availSlotTimeEndNum = (0, helpers_1.timeToMinutes)(availSlotTimeStrEnd);
    while (availSlotTimeStartNum + propertyAvailability.slotDurationMinutes <= availSlotTimeEndNum) {
        const isBlocked = (0, helpers_1.isSlotBlocked)(propertyAvailability.exceptions, availSlotTimeStartNum, propertyAvailability.slotDurationMinutes, targetDate);
        if (!isBlocked) {
            availableSlots.push((0, helpers_1.numberToTimeStr)(availSlotTimeStartNum));
        }
        availSlotTimeStartNum += propertyAvailability.slotDurationMinutes;
    }
    if (availableSlots.length === 0) {
        return {
            found: true,
            message: "No Available slots",
            availableSlots
        };
    }
    return {
        found: true,
        message: "Available time slots found",
        availableSlots: availableSlots
    };
}
exports.getShowingAvailability = getShowingAvailability;
