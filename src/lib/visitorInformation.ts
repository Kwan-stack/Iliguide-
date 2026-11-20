export type VisitorInformation = { fullName: string; address: string; gender: string; nationality: string };

export const requiredVisitorFields = (slug: string): Array<keyof VisitorInformation> => {
  if (slug === 'timoga-cold-springs') return ['fullName', 'address'];
  if (slug === 'tinago-falls' || slug === 'sikyop-agri-tourism-adventure') return ['fullName', 'address', 'gender'];
  if (slug === 'mimbalot-falls') return ['fullName', 'address', 'gender', 'nationality'];
  return [];
};

export const emptyVisitorInformation = (count: number): VisitorInformation[] =>
  Array.from({ length: count }, () => ({ fullName: '', address: '', gender: '', nationality: '' }));

export const resizeVisitorInformation = (visitors: VisitorInformation[], count: number): VisitorInformation[] =>
  Array.from({ length: count }, (_, index) => visitors[index] ?? { fullName: '', address: '', gender: '', nationality: '' });

export const completedVisitorCount = (visitors: VisitorInformation[], slug: string): number => {
  const fields = requiredVisitorFields(slug);
  return fields.length ? visitors.filter((visitor) => fields.every((field) => visitor[field].trim())).length : 0;
};

export const visitorInformationComplete = (visitors: VisitorInformation[], slug: string): boolean =>
  requiredVisitorFields(slug).length === 0 || completedVisitorCount(visitors, slug) === visitors.length;

export const visitorInformationPayload = (visitors: VisitorInformation[], slug: string) => {
  const fields = requiredVisitorFields(slug);
  if (!visitorInformationComplete(visitors, slug)) throw new Error('Complete visitor information for everyone in the reservation.');
  if (!fields.length) return [];
  return visitors.map((visitor) => Object.fromEntries(fields.map((field) => [
    ({ fullName: 'full_name', address: 'address', gender: 'gender', nationality: 'nationality' } as const)[field],
    visitor[field].trim(),
  ])));
};

export const parseVisitorInformation = (serialized: string | null, count: number): VisitorInformation[] | null => {
  if (!serialized) return null;
  try {
    const rows: unknown = JSON.parse(serialized);
    if (!Array.isArray(rows) || rows.length !== count || rows.some((row) => !row ||
      typeof row.fullName !== 'string' || typeof row.address !== 'string' ||
      typeof row.gender !== 'string' || typeof row.nationality !== 'string')) return null;
    return rows as VisitorInformation[];
  } catch { return null; }
};
