import { describe, expect, it } from "vitest";

import {
  isValidMode,
  matchesField,
  normalizeText,
  validatePositiveNumber,
} from "../plugin";

describe("normalizeText", () => {
  it("trims whitespace and enforces the maximum length", () => {
    expect(normalizeText("  hello world  ", 5)).toBe("hello");
  });

  it("returns an empty string for non-string values", () => {
    expect(normalizeText(123)).toBe("");
  });
});

describe("validatePositiveNumber", () => {
  it("accepts finite positive numbers", () => {
    expect(validatePositiveNumber(20, "stake")).toEqual({ ok: true, value: 20 });
  });

  it("rejects zero and negative values", () => {
    expect(validatePositiveNumber(0, "stake")).toEqual({
      ok: false,
      error: "stake must be a positive number",
    });
  });
});

describe("isValidMode", () => {
  it("accepts supported battle modes", () => {
    expect(isValidMode("public-arena")).toBe(true);
    expect(isValidMode("rivalry")).toBe(true);
    expect(isValidMode("ranked-1v1")).toBe(true);
  });

  it("rejects unsupported battle modes", () => {
    expect(isValidMode("casual")).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
  });
});

describe("matchesField", () => {
  it("treats missing and wildcard expectations as a match", () => {
    expect(matchesField(undefined, "public-arena")).toBe(true);
    expect(matchesField("*", "public-arena")).toBe(true);
  });

  it("requires exact equality for concrete values", () => {
    expect(matchesField("public-arena", "public-arena")).toBe(true);
    expect(matchesField("public-arena", "ranked-1v1")).toBe(false);
  });
});
