import { describe, expect, it } from "vitest";
import { mapYuandianResponseBody } from "./map.js";

describe("mapYuandianResponseBody", () => {
  it("maps MCP tools/call structuredContent case rows", () => {
    const body = {
      result: {
        structuredContent: {
          total: 2,
          list: [
            {
              id: "c1",
              title: "某某买卖合同纠纷案",
              case_number: "（2024）沪01民终1234号",
              content: "本院认为……",
              url: "https://example.com/c1",
            },
            { id: "c2", title: "", content: "无标题行应被丢弃" },
          ],
        },
      },
    };
    const hits = mapYuandianResponseBody(body);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: "c1",
      title: "某某买卖合同纠纷案",
      citation: "（2024）沪01民终1234号",
      excerpt: "本院认为……",
      provider: "yuandian",
    });
  });

  it("maps 法条 rows with fgmc + ftnum into a composed citation", () => {
    const body = {
      data: {
        list: [
          {
            id: "f1",
            fgmc: "中华人民共和国民法典",
            ftnum: "第五百六十三条",
            content: "当事人一方依法主张解除合同……",
          },
        ],
      },
    };
    const hits = mapYuandianResponseBody(body);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("中华人民共和国民法典 第五百六十三条");
    expect(hits[0]?.citation).toBe("《中华人民共和国民法典》第五百六十三条");
    expect(hits[0]?.excerpt).toContain("解除合同");
  });

  it("supports extra.fatiao shape (semantic law search) and MCP text-JSON content", () => {
    const body = {
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              extra: {
                fatiao: [
                  { id: "ft9", fgmc: "公司法", ftnum: "第三条", content: "公司是企业法人……" },
                ],
              },
            }),
          },
        ],
      },
    };
    const hits = mapYuandianResponseBody(body);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("ft9");
    expect(hits[0]?.provider).toBe("yuandian");
  });

  it("dedupes identical rows and caps garbage input safely", () => {
    const row = { id: "x", title: "同一份文书", content: "同" };
    const hits = mapYuandianResponseBody({ data: { list: [row, row, { foo: 1 }, null] } });
    expect(hits).toHaveLength(1);
    expect(mapYuandianResponseBody("not json")).toEqual([]);
    expect(mapYuandianResponseBody(undefined)).toEqual([]);
  });
});
