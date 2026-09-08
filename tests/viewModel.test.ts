import { describe, it, expect } from "vitest";
import { groupByDepartment, truncateLines } from "../web/app/lib/viewModel.js";

const agent = (key: string, department: string) =>
  ({ key, department, display_name: key }) as any;

describe("groupByDepartment", () => {
  it("puts Marketing first regardless of input order", () => {
    const groups = groupByDepartment([
      agent("cos", "Office"),
      agent("writer", "Marketing"),
    ]);
    expect(groups.map((g) => g.department)).toEqual(["Marketing", "Office"]);
  });

  it("orders the remaining departments alphabetically", () => {
    const groups = groupByDepartment([
      agent("c", "Support"),
      agent("a", "Finance"),
      agent("b", "Marketing"),
    ]);
    expect(groups.map((g) => g.department)).toEqual(["Marketing", "Finance", "Support"]);
  });

  it("keeps every agent, grouped under its own department", () => {
    const groups = groupByDepartment([
      agent("strategist", "Marketing"),
      agent("writer", "Marketing"),
      agent("cos", "Office"),
    ]);
    // Non-null assertions: this repo's tsconfig sets noUncheckedIndexedAccess,
    // so plain array indexing types as possibly-undefined even though the
    // three agents above guarantee exactly two groups here.
    expect(groups[0]!.agents.map((a) => a.key)).toEqual(["strategist", "writer"]);
    expect(groups[1]!.agents.map((a) => a.key)).toEqual(["cos"]);
  });

  it("returns nothing for no agents", () => {
    expect(groupByDepartment([])).toEqual([]);
  });
});

describe("truncateLines", () => {
  it("returns a short body untouched", () => {
    expect(truncateLines("one\ntwo", 4)).toBe("one\ntwo");
  });

  it("cuts to the line limit and marks the cut", () => {
    expect(truncateLines("1\n2\n3\n4\n5", 3)).toBe("1\n2\n3…");
  });

  it("treats a blank body as empty", () => {
    expect(truncateLines("", 4)).toBe("");
  });
});
