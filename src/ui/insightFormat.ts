import { daysBetween } from '../domain/date';
import type { ISODate } from '../domain/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(date: ISODate): { year: string; month: string; day: number } {
  const [year, month, day] = date.split('-');
  return { year, month: MONTHS[Number(month) - 1], day: Number(day) };
}

/** '3 Aug', with the year only when it is not the year of `asOf`. */
export function shortDate(date: ISODate, asOf: ISODate): string {
  const { year, month, day } = parts(date);
  return year === parts(asOf).year ? `${day} ${month}` : `${day} ${month} ${year}`;
}

/** 'Aug 2026' */
export function monthYear(date: ISODate): string {
  const { year, month } = parts(date);
  return `${month} ${year}`;
}

/** 'today', 'yesterday', '3 days ago'. */
export function sinceLabel(date: ISODate, asOf: ISODate): string {
  const days = daysBetween(date, asOf);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
