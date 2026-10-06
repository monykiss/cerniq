import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_KEY_STORAGE,
  clearStoredAdminKey,
  getStoredAdminKey,
  hasStoredAdminKey,
  persistAdminKey,
} from "./admin-session";

describe("admin-session", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    clearStoredAdminKey();
  });

  it("persists and reads the admin key from session storage", () => {
    persistAdminKey("secret-key");

    expect(getStoredAdminKey()).toBe("secret-key");
    expect(sessionStorage.getItem(ADMIN_KEY_STORAGE)).toBe("secret-key");
    expect(hasStoredAdminKey()).toBe(true);
  });

  it("migrates a legacy localStorage key into session storage", () => {
    localStorage.setItem("admin_key", "legacy-key");

    expect(getStoredAdminKey()).toBe("legacy-key");
    expect(sessionStorage.getItem(ADMIN_KEY_STORAGE)).toBe("legacy-key");
    expect(localStorage.getItem("admin_key")).toBeNull();
  });
});
