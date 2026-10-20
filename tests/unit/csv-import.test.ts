import { describe, expect, it } from "vitest";
import { CsvError, neutralise, parseCsv, toCsv } from "@/lib/csv";
import { detectHeaders, parseFlexibleDate, rowFromCells, validateRow, TEMPLATE_HEADERS } from "@/lib/import/students";

describe("CSV parser", () => {
  it("handles quotes, escaped quotes, embedded commas/newlines, CRLF, BOM and blank lines", () => {
    const csv = '﻿first_name,last_name,address\r\n"Asha","Mushi, Jr.","Plot 5\nArusha ""town"""\r\n\r\nJuma,Said,\r\n';
    const { rows } = parseCsv(csv);
    expect(rows).toEqual([["first_name", "last_name", "address"], ["Asha", "Mushi, Jr.", 'Plot 5\nArusha "town"'], ["Juma", "Said", ""]]);
  });
  it("detects semicolon and tab delimiters (common in Excel exports)", () => {
    expect(parseCsv("a;b;c\n1;2;3").rows[1]).toEqual(["1", "2", "3"]);
    expect(parseCsv("a\tb\n1\t2").rows[1]).toEqual(["1", "2"]);
  });
  it("enforces limits and rejects broken files", () => {
    expect(() => parseCsv("")).toThrow(CsvError);
    expect(() => parseCsv('a,b\n"unterminated')).toThrow(/not closed/);
    expect(() => parseCsv("a\n1\n2\n3", { maxRows: 2, maxCols: 5, maxCell: 100 })).toThrow(/more than 2 rows/);
    expect(() => parseCsv("a,b,c\n1,2,3", { maxRows: 5, maxCols: 2, maxCell: 100 })).toThrow(/too many columns/);
    expect(() => parseCsv(`a\n${"x".repeat(50)}`, { maxRows: 5, maxCols: 5, maxCell: 10 })).toThrow(/too long/);
  });
  it("neutralises spreadsheet formulas when writing", () => {
    expect(neutralise("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(neutralise("+255712345678")).toBe("'+255712345678");
    expect(neutralise("Normal")).toBe("Normal");
    expect(toCsv([["a", '=1+1', 'say "hi", ok']])).toBe("a,'=1+1,\"say \"\"hi\"\", ok\"\r\n");
  });
});

describe("header detection", () => {
  it("maps English and Kiswahili synonyms, ignores unknown columns and reports missing required ones", () => {
    const d = detectHeaders(["Jina la kwanza", "Surname", "DOB", "Sex", "Parent Name", "Phone", "Favourite colour"]);
    expect(d.missing).toEqual([]);
    expect(d.map).toMatchObject({ firstName: 0, lastName: 1, dateOfBirth: 2, gender: 3, guardianName: 4, guardianPhone: 5 });
    expect(d.columns[6]!.field).toBeNull();
    expect(detectHeaders(["first_name", "last_name"]).missing).toEqual(["dateOfBirth", "gender", "guardianName", "guardianPhone"]);
  });
  it("the downloadable template contains exactly the recognised columns and no sample students", () => {
    const d = detectHeaders([...TEMPLATE_HEADERS]);
    expect(d.missing).toEqual([]);
    expect(d.columns.every((c) => c.field !== null)).toBe(true);
    expect(toCsv([[...TEMPLATE_HEADERS]]).trim().split("\r\n")).toHaveLength(1);
  });
  it("uses the first column when a field appears twice", () => {
    expect(detectHeaders(["First Name", "firstname", "Last", "dob", "gender", "guardian", "phone"]).map.firstName).toBe(0);
  });
});

describe("row validation", () => {
  const refs = { today: new Date("2026-10-20T00:00:00Z"), classes: [{ id: "c1", name: "Standard I", nameSw: "Darasa la I", streams: [] }, { id: "c2", name: "Standard II", nameSw: null, streams: [{ id: "s1", name: "A" }] }] };
  const base = { firstName: "Asha", lastName: "Mushi", dateOfBirth: "05/03/2018", gender: "F", guardianName: "Neema Mushi", guardianPhone: "0712 345 678" };
  const codes = (raw: Record<string, string>) => validateRow(raw, refs).errors.map((e) => `${e.code}:${e.field ?? ""}`);

  it("parses day-first and ISO dates, rejects impossible ones", () => {
    expect(parseFlexibleDate("05/03/2018")?.toISOString().slice(0, 10)).toBe("2018-03-05");
    expect(parseFlexibleDate("5-3-2018")?.toISOString().slice(0, 10)).toBe("2018-03-05");
    expect(parseFlexibleDate("2018-03-05")?.toISOString().slice(0, 10)).toBe("2018-03-05");
    expect(parseFlexibleDate("31/02/2018")).toBeNull();
    expect(parseFlexibleDate("03/25/2018")).toBeNull(); // month-first is not guessed
    expect(parseFlexibleDate("March 5")).toBeNull();
  });

  it("accepts a good row and normalises it", () => {
    const { parsed, errors } = validateRow({ ...base, className: "Standard I" }, refs);
    expect(errors).toEqual([]);
    expect(parsed).toMatchObject({ dateOfBirth: "2018-03-05", gender: "FEMALE", classId: "c1", guardians: [{ fullName: "Neema Mushi", phone: "+255712345678", relationship: "GUARDIAN" }] });
  });

  it("reports precise problems for each bad field", () => {
    expect(codes({})).toContain("REQUIRED:firstName");
    expect(codes({ ...base, dateOfBirth: "2999-01-01" })).toEqual(["DOB_NOT_PAST:dateOfBirth"]);
    expect(codes({ ...base, dateOfBirth: "yesterday" })).toEqual(["INVALID_DATE:dateOfBirth"]);
    expect(codes({ ...base, gender: "x" })).toEqual(["INVALID_GENDER:gender"]);
    expect(codes({ ...base, guardianPhone: "12345" })).toEqual(["INVALID_PHONE:guardianPhone"]);
    expect(codes({ ...base, guardianRelationship: "friend" })).toEqual(["INVALID_RELATIONSHIP:guardianRelationship"]);
    expect(codes({ ...base, className: "Standard IX" })).toEqual(["UNKNOWN_CLASS:className"]);
    expect(codes({ ...base, className: "Standard II" })).toEqual(["STREAM_REQUIRED:streamName"]);
    expect(codes({ ...base, className: "Standard II", streamName: "Z" })).toEqual(["UNKNOWN_STREAM:streamName"]);
    expect(codes({ ...base, className: "Standard I", streamName: "A" })).toEqual(["UNKNOWN_STREAM:streamName"]);
    expect(codes({ ...base, streamName: "A" })).toEqual(["STREAM_WITHOUT_CLASS:streamName"]);
    expect(codes({ ...base, admissionNo: "bad number!" })).toEqual(["ADMISSION_NO_FORMAT:admissionNo"]);
    expect(codes({ ...base, admissionDate: "01/01/2010" })).toEqual(["DOB_AFTER_ADMISSION:admissionDate"]);
    expect(codes({ ...base, guardian2Name: "Someone" })).toEqual(["REQUIRED:guardian2Phone"]);
    expect(codes({ ...base, firstName: "x".repeat(80) })).toEqual(["TOO_LONG:firstName"]);
    expect(validateRow({ ...base, gender: "kike", guardianRelationship: "mama", className: "Darasa la I" }, refs).parsed).toMatchObject({ gender: "FEMALE", classId: "c1", guardians: [{ relationship: "MOTHER" }] });
  });

  it("builds raw rows from cells using the detected mapping", () => {
    const { map } = detectHeaders(["first_name", "last_name", "dob", "sex", "guardian", "phone"]);
    expect(rowFromCells([" Asha ", "Mushi", "05/03/2018", "F", "Neema", "0712345678", "extra"], map)).toEqual({ firstName: "Asha", lastName: "Mushi", dateOfBirth: "05/03/2018", gender: "F", guardianName: "Neema", guardianPhone: "0712345678" });
  });
});
