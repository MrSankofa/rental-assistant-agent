"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.availability = void 0;
exports.availability = {
    virginia: {
        timezone: "America/Detroit",
        activeFrom: "2026-10-07",
        activeUntil: "2026-10-17",
        slotDurationMinutes: 30,
        exceptions: [
            {
                start: "2026-10-10T17:00:00",
                end: "2026-10-10T17:30:00"
            },
            {
                start: "2026-10-10T17:00:00",
                end: "2026-11-10T17:30:00"
            }
        ],
        weeklySchedule: {
            sunday: {
                availableStart: "14:00:00",
                availableEnd: "20:00:00",
            },
            monday: {
                availableStart: "14:00:00",
                availableEnd: "20:00:00",
            },
            tuesday: {
                availableStart: "14:00:00",
                availableEnd: "20:00:00",
            },
            wednesday: {
                availableStart: "14:00:00",
                availableEnd: "20:00:00",
            },
            thursday: {
                availableStart: "14:00:00",
                availableEnd: "20:00:00",
            },
            friday: {
                availableStart: "14:00:00",
                availableEnd: "20:00:00",
            },
            saturday: {
                availableStart: "14:00:00",
                availableEnd: "20:00:00",
            },
        }
    }
};
