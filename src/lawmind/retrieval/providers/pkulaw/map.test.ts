import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inferPkulawSearchKind, mapPkulawResponseBody } from "./map.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("pkulaw/map", () => {
  it("maps law-search fixture hits", () => {
    const body = JSON.parse(
      readFileSync(path.join(HERE, "fixtures/law-search-hits.json"), "utf8"),
    ) as unknown;
    const hits = mapPkulawResponseBody(body);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("statute");
    expect(hits[0]?.citation).toContain("563");
  });

  it("maps case-search fixture list", () => {
    const body = JSON.parse(
      readFileSync(path.join(HERE, "fixtures/case-search-hits.json"), "utf8"),
    ) as unknown;
    const hits = mapPkulawResponseBody(body);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("case");
    expect(hits[0]?.title).toContain("租赁");
  });

  it("infers search kind from query", () => {
    expect(inferPkulawSearchKind("民法典解除")).toBe("law");
    expect(inferPkulawSearchKind("类案 押金")).toBe("case");
  });
});
