import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import i18n from '../i18n';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat(i18n.language || 'en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export function formatDate(date: Date | string | number) {
  return new Intl.DateTimeFormat(i18n.language || 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}
