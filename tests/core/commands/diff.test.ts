import { describe, it, expect } from "vitest";
import { diffFrontmatter } from "../../../src/core/commands/diff";

describe("diffFrontmatter", () => {
  it("meldet nur die Keys, die sich unterscheiden", () => {
    const rows = diffFrontmatter({ subject: "alt", from: "a@x" }, { subject: "neu", from: "a@x" }, ["subject", "from"]);
    expect(rows).toEqual([{ field: "subject", before: "alt", after: "neu" }]);
  });

  it("formatiert Listen als Aufzaehlung", () => {
    const rows = diffFrontmatter({ to: ["a@x"] }, { to: ["a@x", "b@x"] }, ["to"]);
    expect(rows).toEqual([{ field: "to", before: "a@x", after: "a@x, b@x" }]);
  });

  it("laesst before weg, wenn der Key vorher gar nicht da war", () => {
    expect(diffFrontmatter({}, { cc: [] }, ["cc"])).toEqual([{ field: "cc", after: "" }]);
  });

  it("beruecksichtigt nur die uebergebenen Keys", () => {
    expect(diffFrontmatter({ eigenes: "a" }, { eigenes: "b" } as never, ["subject"])).toEqual([]);
  });
});
