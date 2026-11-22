export function dutyWindowStatus(startAt: string, endAt: string, now = Date.now()) {
  if (now < Date.parse(startAt)) return 'Scheduled Today';
  if (now < Date.parse(endAt)) return 'On Duty';
  return 'Completed';
}
