alter type public.payment_status add value if not exists 'pending_verification';
alter type public.payment_status add value if not exists 'rejected';
