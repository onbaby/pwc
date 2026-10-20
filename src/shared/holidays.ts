import { HOLIDAY_RULES } from "./constants.ts";
import { dayOf, weekday, ymd, type Day } from "./dates.ts";

/** Holiday travel windows (HOLIDAY_RULES), computed per year so nothing is a hard-coded date. */
export interface HolidayWindow {
  name: "Thanksgiving" | "the holidays";
  from: Day;
  to: Day;
}

/** Fourth Thursday of November. */
export function thanksgiving(year: number): Day {
  const nov1 = dayOf(year, 11, 1);
  const firstThu = nov1 + ((4 - weekday(nov1) + 7) % 7);
  return firstThu + 21;
}

export function holidayWindows(year: number): HolidayWindow[] {
  const t = thanksgiving(year);
  const w = HOLIDAY_RULES.winter;
  return [
    { name: "Thanksgiving", from: t + HOLIDAY_RULES.thanksgiving.fromOffset, to: t + HOLIDAY_RULES.thanksgiving.toOffset },
    { name: "the holidays", from: dayOf(year, w.fromMonthDay[0], w.fromMonthDay[1]), to: dayOf(year + 1, w.toMonthDay[0], w.toMonthDay[1]) },
  ];
}

/** The holiday window `day` falls in, if any (checks the windows that start in this year and the year before). */
export function holidayWindowFor(day: Day): HolidayWindow | undefined {
  const y = ymd(day).year;
  return [...holidayWindows(y - 1), ...holidayWindows(y)].find((h) => day >= h.from && day <= h.to);
}

/** Windows that start on or after `from`, in date order, for the next `count`. */
export function upcomingHolidayWindows(from: Day, count = 4): HolidayWindow[] {
  const y = ymd(from).year;
  return [...holidayWindows(y - 1), ...holidayWindows(y), ...holidayWindows(y + 1)].filter((h) => h.to >= from).sort((a, b) => a.from - b.from).slice(0, count);
}
