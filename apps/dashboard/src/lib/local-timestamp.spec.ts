import { formatLocalTimestamp, parseLocalTimestamp } from "./local-timestamp";

describe("local timestamp", () => {
  it("keeps a Bogotá 09:00 wall-clock value at 09:00", () => {
    expect(parseLocalTimestamp("2030-08-10T09:00:00")).toMatchObject({ hour: 9, minute: 0 });
    expect(formatLocalTimestamp("2030-08-10T09:00:00", "en-GB")).toContain("09:00");
  });

  it("does not apply a timezone suffix to TIMESTAMP wall-clock components", () => {
    expect(formatLocalTimestamp("2030-08-10T09:00:00.000Z", "en-GB")).toContain("09:00");
  });
});
