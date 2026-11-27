export type Party = { adults: number; children: number; pwd: number };
export type PendingReservation = { siteId: string; date: string; slotId: string; party: Party; savedAt: number };

export function parsePendingReservation(serialized: string | null, today: string, now = Date.now()): PendingReservation | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<PendingReservation>;
    const party = value.party as Partial<Party> | undefined;
    const savedAt = value.savedAt;
    const date = String(value.date ?? '');
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date + 'T00:00:00.000Z').toISOString().slice(0, 10) === date;
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(String(value.siteId ?? ''))
      || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(String(value.slotId ?? ''))
      || !validDate || date < today || typeof savedAt !== 'number' || !Number.isSafeInteger(savedAt)
      || now - savedAt > 7 * 24 * 60 * 60 * 1000 || savedAt > now + 60_000
      || !Number.isSafeInteger(party?.adults) || (party?.adults ?? 0) < 1
      || !Number.isSafeInteger(party?.children) || (party?.children ?? -1) < 0
      || !Number.isSafeInteger(party?.pwd) || (party?.pwd ?? -1) < 0
      || (party?.adults ?? 101) + (party?.children ?? 101) > 100
      || (party?.pwd ?? 101) > (party?.adults ?? 0) + (party?.children ?? 0)) return null;
    return { siteId: value.siteId!, date, slotId: value.slotId!, party: party as Party, savedAt };
  } catch { return null; }
}
