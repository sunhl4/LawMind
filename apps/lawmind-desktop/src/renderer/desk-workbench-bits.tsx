import type { ReactNode } from "react";

export type IntakeBriefView = {
  clientNeeds: string[];
  coreFacts: string[];
  issues?: string[];
  causeCandidates: Array<{ label: string; reason: string }>;
  evidenceGaps: string[];
  nextActions: string[];
  confirmedAt?: string;
  /** 读到了、但已到当事人上限没有写入卷宗的人。 */
  omittedPartyNotes?: string[];
};

export function DeskGlyph(props: {
  name: "gavel" | "cal" | "folder" | "mail" | "search" | "plus" | "talk";
}): ReactNode {
  const { name } = props;
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      {name === "search" ? (
        <>
          <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16.5L20 20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
      {name === "gavel" ? (
        <path
          d="M4 19h10M8 17l8-8 2.5 2.5-8 8H8v-2.5Zm8.5-9.5L18 6l2 2-1.5 2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "cal" ? (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 4v3M16 4v3M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </>
      ) : null}
      {name === "folder" ? (
        <path
          d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4L11 8h7.5A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-10Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
      ) : null}
      {name === "mail" ? (
        <path
          d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-9Zm1.2-.3L12 12l6.8-4.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      ) : null}
      {name === "plus" ? (
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : null}
      {name === "talk" ? (
        <path
          d="M7 8h10M7 12h6M6 5h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 3v-3H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

export function IntakeBriefBlocks(props: {
  brief: IntakeBriefView;
  onApplyCause: (label: string) => void;
}): ReactNode {
  const { brief, onApplyCause } = props;
  return (
    <div className="lm-lawyer-brief">
      <BriefList title="客户需求" items={brief.clientNeeds} />
      <BriefList title="要件事实" items={brief.coreFacts} />
      <BriefList title="争点" items={brief.issues ?? []} />
      <div className="lm-lawyer-brief-block">
        <h4>候选案由</h4>
        {brief.causeCandidates.length === 0 ? (
          <p className="lm-meta">内置案由里没有对上的。可在本案卷宗里直接填写案由。</p>
        ) : (
          <ul>
            {brief.causeCandidates.map((c) => (
              <li key={c.label} className="lm-lawyer-cause-row">
                <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={() => onApplyCause(c.label)}>
                  采用「{c.label}」
                </button>
                <span className="lm-meta">{c.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <BriefList title="未写入卷宗的当事人" items={brief.omittedPartyNotes ?? []} />
      <BriefList title="证据缺口" items={brief.evidenceGaps} />
      <BriefList title="下一步" items={brief.nextActions} />
    </div>
  );
}

function BriefList(props: { title: string; items: string[] }): ReactNode {
  if (props.items.length === 0) {
    return null;
  }
  return (
    <div className="lm-lawyer-brief-block">
      <h4>{props.title}</h4>
      <ul>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
