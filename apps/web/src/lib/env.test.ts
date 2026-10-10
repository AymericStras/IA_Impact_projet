import { describe, expect, it } from "vitest";
import { normalizeBasePath, resolveApiRoot } from "./env";

describe("resolveApiRoot", () => {
  it("uses an absolute API base URL as-is", () => {
    expect(resolveApiRoot("http://localhost:8000", "")).toBe("http://localhost:8000/api/v1");
    expect(resolveApiRoot("https://api.example.org/", "/sncf-chatbot")).toBe("https://api.example.org/api/v1");
  });

  it("calls the same origin under the base path when the API base URL is empty", () => {
    expect(resolveApiRoot("", "/sncf-chatbot")).toBe("/sncf-chatbot/api/v1");
    expect(resolveApiRoot("", "/sncf-chatbot/")).toBe("/sncf-chatbot/api/v1");
  });

  it("calls the same origin at the root when both are empty", () => {
    expect(resolveApiRoot("", "")).toBe("/api/v1");
    expect(resolveApiRoot("", undefined)).toBe("/api/v1");
  });

  it("falls back to the local API when the variable is not set at all", () => {
    expect(resolveApiRoot(undefined, "")).toBe("http://localhost:8000/api/v1");
  });
});

describe("normalizeBasePath", () => {
  it("normalises slashes", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("sncf-chatbot")).toBe("/sncf-chatbot");
    expect(normalizeBasePath("/sncf-chatbot/")).toBe("/sncf-chatbot");
  });
});
