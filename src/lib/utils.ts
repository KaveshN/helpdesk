import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Class-name helper used by every shadcn primitive: `clsx` handles
 * conditionals, `tailwind-merge` resolves conflicts so a caller's `px-2`
 * beats the variant's `px-4` instead of both being emitted.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
