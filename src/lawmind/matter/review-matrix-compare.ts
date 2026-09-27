/** Browser-safe matrix excerpt compare (no node:fs). */

export function compareMatrixExcerpts(
  before: string,
  after: string,
): { changed: boolean; danger: boolean; summary: string } {
  const a = before.trim();
  const b = after.trim();
  if (a === b) {
    return { changed: false, danger: false, summary: "无变化" };
  }
  const dangerWords = /无限责任|全部损失|放弃|不可撤销|单方解除|自动续期/;
  const capWords = /责任上限|赔偿上限|赔偿限额/;
  const gainedDanger = dangerWords.test(b) && !dangerWords.test(a);
  const lostCap = capWords.test(a) && !capWords.test(b);
  const danger = gainedDanger || lostCap;
  return {
    changed: true,
    danger,
    summary: !danger
      ? "条款内容有变化，请人工核对"
      : lostCap && !gainedDanger
        ? "危险变更：责任上限被拿掉"
        : "危险变更：出现高风险表述",
  };
}
