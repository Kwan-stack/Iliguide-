export function bookingContactError(name: string, email: string, phone: string): string | null {
  if (!name.trim() || name.trim().length > 120) return 'Enter a valid booking name.';
  const address = email.trim();
  if (address.length > 254 || (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) {
    return 'Enter a valid email address or leave it blank.';
  }
  const number = phone.trim();
  const digits = number.replace(/\D/g, '').length;
  if (number && (digits < 7 || digits > 15)) return 'Enter a phone number with 7 to 15 digits.';
  if (!address && !number) return 'Enter at least one contact method: email or phone.';
  return null;
}
