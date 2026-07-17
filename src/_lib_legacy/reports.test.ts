import { describe, expect, it } from "vitest";
import { periodRange, scheduledReportTypes } from "./reports";

describe("report periods", () => {
  it("builds one calendar day for EOD", () => {
    const range = periodRange("EOD", new Date(2026, 6, 11, 12));
    expect(new Date(range.start).getDate()).toBe(11);
    expect(new Date(range.end).getDate()).toBe(11);
  });
  it("starts EOW on Monday and ends Sunday", () => {
    const range = periodRange("EOW", new Date(2026, 6, 11, 12));
    expect(new Date(range.start).getDay()).toBe(1);
    expect(new Date(range.end).getDay()).toBe(0);
  });
  it("covers the anchor month for EOM", () => {
    const range = periodRange("EOM", new Date(2026, 6, 11, 12));
    expect(new Date(range.start).getDate()).toBe(1);
    expect(new Date(range.end).getMonth()).toBe(6);
    expect(new Date(range.end).getDate()).toBe(31);
  });
  it("adds weekly reports on Friday", () => {
    expect(scheduledReportTypes(new Date(2026, 6, 10, 16))).toContain("EOW");
  });
  it("adds monthly reports on the final weekday", () => {
    expect(scheduledReportTypes(new Date(2026, 6, 31, 16))).toContain("EOM");
  });
});
