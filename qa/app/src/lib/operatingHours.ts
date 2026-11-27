export type WeeklyOperatingHour = { weekday: number; opens_at: string; closes_at: string; is_closed: boolean };

export function applyOperatingHoursTemplate(hours: WeeklyOperatingHour[], targetDays: number[]) {
  const source = hours.find((hour) => hour.weekday === 1 && !hour.is_closed && hour.opens_at && hour.closes_at)
    ?? hours.find((hour) => targetDays.includes(hour.weekday) && !hour.is_closed && hour.opens_at && hour.closes_at);
  if (!source) return null;
  return hours.map((hour) => targetDays.includes(hour.weekday)
    ? { ...hour, opens_at: source.opens_at, closes_at: source.closes_at, is_closed: false }
    : hour);
}
