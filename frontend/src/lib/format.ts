export const localDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';
