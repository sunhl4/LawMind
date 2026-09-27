/** 演示案件 ID。直接开始不往输入框塞说明；示例句在空对话里点选。 */
export const FIRST_RUN_DEMO_MATTER_ID = "演示案件";

/** 空对话可点的第一句。点了只填进输入框，律师改完再发。 */
export const DAY_ONE_EXAMPLE_PROMPTS: ReadonlyArray<{ id: string; label: string; prompt: string }> = [
  {
    id: "memo",
    label: "写一份备忘",
    prompt: "查一下民法典关于违约金过高的规定，写个备忘。",
  },
  {
    id: "review",
    label: "审违约责任",
    prompt: "审一下这份合同的违约责任。",
  },
  {
    id: "summons",
    label: "记下传票",
    prompt: "记一下这份传票里的开庭时间和案号。",
  },
];
