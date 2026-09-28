import { describe, expect, it } from "vitest";
import { planTranscriptMutate, transcriptTextsMatch } from "./resolve-transcript-cut.js";

const user = (text: string) => ({ role: "user" as const, text });
const assistant = (text: string) => ({ role: "assistant" as const, text });

describe("planTranscriptMutate", () => {
  it("keeps the index when the open transcript matches the session", () => {
    const messages = [user("q1"), assistant("a1"), user("q2"), assistant("a2")];
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages: messages,
        clientIndex: 2,
        serverMessages: messages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 2 });
  });

  it("finds the failed question when local error rows push its index out of range", () => {
    const failed = "按照上面的输出进行合并，尽量能合并的都合并";
    const clientMessages = [
      user("先出一版"),
      assistant("第一版"),
      assistant("本轮模型调用失败：DNS"),
      user(failed),
      assistant("本轮模型调用失败：DNS"),
    ];
    const serverMessages = [user("先出一版"), assistant("第一版"), user(failed)];
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages,
        clientIndex: 3,
        serverMessages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 2 });
  });

  it("still finds the question when assistant prose on screen differs from the saved answer", () => {
    const clientMessages = [user("审合同"), assistant("流式过程里的长说明"), user("再改一版")];
    const serverMessages = [user("审合同"), assistant("最终只留这一句"), user("再改一版")];
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages,
        clientIndex: 2,
        serverMessages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 2 });
  });

  it("finds the latest question after compact shrinks the saved transcript", () => {
    const latest = "按照上面的输出进行合并，尽量能合并的都合并";
    const clientMessages: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (let i = 0; i < 12; i += 1) {
      clientMessages.push(user(`旧问题 ${i}`), assistant(`旧回答 ${i}`));
    }
    clientMessages.push(user(latest), assistant("本轮模型调用失败：DNS"));
    const serverMessages = [user("旧问题 11"), assistant("旧回答 11"), user(latest)];
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages,
        clientIndex: clientMessages.length - 2,
        serverMessages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 2 });
  });

  it("drops the kept suffix when the edited question was compacted off the session", () => {
    const clientMessages = [
      user("很早的问题"),
      assistant("很早的回答"),
      user("被压缩掉的这句"),
      assistant("也被压缩掉"),
      user("还在的问题"),
      assistant("还在的回答"),
    ];
    const serverMessages = [user("还在的问题"), assistant("还在的回答")];
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages,
        clientIndex: 2,
        serverMessages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 0 });
  });

  it("resends locally when the failed question never landed in the session", () => {
    const clientMessages = [user("已保存"), assistant("答"), user("没写进会话"), assistant("DNS")];
    const serverMessages = [user("已保存"), assistant("答")];
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages,
        clientIndex: 2,
        serverMessages,
      }),
    ).toEqual({ action: "local" });
  });

  it("pairs duplicate questions from the tail", () => {
    const clientMessages = [
      user("继续"),
      assistant("第一次"),
      assistant("本地失败"),
      user("继续"),
      assistant("第二次"),
    ];
    const serverMessages = [user("继续"), assistant("第一次"), user("继续"), assistant("第二次")];
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages,
        clientIndex: 0,
        serverMessages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 0 });
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages,
        clientIndex: 3,
        serverMessages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 2 });
  });

  it("matches a question stored with a file-context prefix", () => {
    const typed = "按照上面的输出进行合并";
    const serverText = `【用户在 LawMind 文件页】\n- [项目 · 路径引用] \`报告.docx\`\n\n${typed}`;
    expect(transcriptTextsMatch(serverText, typed)).toBe(true);
    expect(
      planTranscriptMutate({
        mode: "truncate",
        clientMessages: [user(typed), assistant("DNS")],
        clientIndex: 0,
        serverMessages: [user(serverText)],
      }),
    ).toEqual({ action: "mutate", uiIndex: 0 });
  });

  it("deletes a local model-failure row without touching a later saved turn", () => {
    const clientMessages = [user("q"), assistant("DNS 失败"), user("下一句")];
    const serverMessages = [user("q"), user("下一句")];
    expect(
      planTranscriptMutate({
        mode: "delete_pair",
        clientMessages,
        clientIndex: 1,
        serverMessages,
      }),
    ).toEqual({ action: "local" });
    expect(
      planTranscriptMutate({
        mode: "delete_pair",
        clientMessages,
        clientIndex: 0,
        serverMessages,
      }),
    ).toEqual({ action: "mutate", uiIndex: 0 });
  });
});
