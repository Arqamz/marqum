import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge that knows our token font sizes (text-hero, text-headline) aren't colours. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["hero", "headline"],
      radius: ["sheet", "card", "control", "inner", "chip"],
      shadow: ["float"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
