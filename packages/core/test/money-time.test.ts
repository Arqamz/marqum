import { describe, expect, it } from "vitest";
import { formatRs, formatRsSigned, parseRs, toPaisa } from "../src/money.ts";
import {
  addDays,
  addMonths,
  completeMonthsBefore,
  dayLabel,
  daysInMonth,
  karachiNow,
  monthLabel,
  monthOf,
  monthRange,
  weekdayIndex,
} from "../src/time.ts";

describe("money", () => {
  it("formats rupees with grouping and signs", () => {
    expect(formatRs(123400)).toBe("Rs 1,234");
    expect(formatRs(-50000)).toBe("−Rs 500");
    expect(formatRs(3330000, { sign: true })).toBe("+Rs 33,300");
    expect(formatRsSigned(-120)).toBe("−Rs 1");
    expect(formatRs(0, { sign: true })).toBe("Rs 0");
    expect(formatRs(123450, { decimals: true })).toBe("Rs 1,234.50");
    expect(formatRs(850000000)).toBe("Rs 8,500,000");
  });
  it("converts and parses", () => {
    expect(toPaisa(12.345)).toBe(1235);
    expect(parseRs("Rs 1,234.50")).toBe(123450);
    expect(parseRs("−Rs 500")).toBe(-50000);
    expect(parseRs("PKR 85,000")).toBe(8500000);
    expect(parseRs("(500)")).toBe(-50000);
    expect(parseRs("+33,300")).toBe(3330000);
    expect(parseRs("12.5")).toBe(1250);
    expect(parseRs("abc")).toBeNull();
    expect(parseRs("1,23")).toBeNull();
  });
});

describe("time", () => {
  it("does month arithmetic", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(daysInMonth("2028-02")).toBe(29);
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(completeMonthsBefore("2026-11", 3)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthOf("2026-11-07T10:00")).toBe("2026-11");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(weekdayIndex("2026-11-09")).toBe(0); // Monday
  });
  it("labels", () => {
    expect(dayLabel("2026-11-07")).toBe("7 Nov");
    expect(monthLabel("2027-02")).toBe("Feb 2027");
    expect(karachiNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe("formatRs compact", () => {
  it.each([
    [99900, "Rs 999"],
    [100000, "Rs 1k"],
    [1234500, "Rs 12.3k"],
    [-1234500, "−Rs 12.3k"],
    [12345600, "Rs 123k"],
    [99950000, "Rs 1M"],
    [123456700, "Rs 1.2M"],
  ])("%d → %s", (p, s) => {
    expect(formatRs(p, { compact: true })).toBe(s);
  });
  it("keeps the sign option", () => {
    expect(formatRs(250000, { compact: true, sign: true })).toBe("+Rs 2.5k");
  });
});
