import { describe, it, expect } from "vitest";
import MailstonePlugin from "../src/main";
describe("plugin class", () => {
  it("exportiert eine Plugin-Klasse", () => { expect(typeof MailstonePlugin).toBe("function"); });
});
