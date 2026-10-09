import { DayOfWeek, ScheduleException } from "../types/scheduling";

export function timeToMinutes(timeStr: string): number {
  const [hours, minutes, seconds] = timeStr.split(":").map(Number);

  return (hours * 60) + minutes;
}

export function numberToTimeStr(timeNum: number): string {
  // Ensure we don't exceed 24 hours
  const boundedMinutes = timeNum % 1440;

  const hours = Math.floor(boundedMinutes / 60);
  const minutes = boundedMinutes % 60;

  // Pad with leading zeros to guarantee clean string comparisons later
  const hStr = String(hours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');

  return `${hStr}:${mStr}:00`;
}

export function getDayOfWeek(dateStr: string): DayOfWeek {
  const days: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // Split the YYYY-MM-DD string into components
  const [year, month, day] = dateStr.split('-').map(Number);

  // Note: JavaScript months are 0-indexed (January is 0, October is 9)
  const date = new Date(year, month - 1, day);

  return days[date.getDay()];
}

export function isSlotBlocked(
  exceptions: ScheduleException[],
  slotStart: number,
  durationMinutes: number,
  targetDate: string
): boolean {

  return exceptions.some(excp => {
    const [blockStartDate, blockStartTimeStr] =
      excp.start.split("T");

    const [blockEndDate, blockEndTimeStr] =
      excp.end.split("T");

    if (
      blockStartDate !== targetDate ||
      blockEndDate !== targetDate
    ) {
      return false;
    }

    const exceptionStart =
      timeToMinutes(blockStartTimeStr);

    const exceptionEnd =
      timeToMinutes(blockEndTimeStr);

    const slotEnd =
      slotStart + durationMinutes;

    return (
      slotStart < exceptionEnd &&
      slotEnd > exceptionStart
    );
  });


}