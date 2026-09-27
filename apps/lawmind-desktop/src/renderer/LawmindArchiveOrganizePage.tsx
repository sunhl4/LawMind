/**
 * 整理指定范围里的文件：新建案件、收进已有案件，或把一般资料按类型收好。
 * 从设置进入。确认后才复制，不改原文件，不把正文发给模型。
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { requestReturnFromArchiveOrganize } from "./lawmind-automations-nav-bus";

type ScanRoot = { id: string; absPath: string; label?: string };
type CatalogItem = { layout?: string; proposedMatterLabel?: string };
type PlanGroup = { label: string; count: number };
type IntoGroup = { matterId: string; displayName: string; count: number };
type LibraryGroup = { kind: string; label: string; count: number };
type ScanPlan = {
  createMatters: PlanGroup[];
  intoMatters: IntoGroup[];
  library: LibraryGroup[];
};

type ScanJob = {
  scanId?: string;
  stats?: {
    cataloged?: number;
    messyFiles?: number;
    habitsQueued?: number;
    truncated?: boolean;
    filesChanged?: number;
    incremental?: boolean;
  };
  catalog?: CatalogItem[];
};

type Props = {
  apiBase: string;
  onBack?: () => void;
};

function folderName(root: ScanRoot): string {
  const label = root.label?.trim();
  if (label) {
    return label;
  }
  return root.absPath.split(/[\\/]/).filter(Boolean).pop() ?? root.absPath;
}

function rootError(code: string | undefined): string {
  switch (code) {
    case "max_roots":
      return "一次最多选三个文件夹。先移除一个，再添加。";
    case "duplicate_root":
      return "这个文件夹已经在列表里。";
    case "path_not_found":
    case "not_directory":
      return "找不到这个文件夹。";
    default:
      return "没能添加这个文件夹。";
  }
}

export function LawmindArchiveOrganizePage({ apiBase, onBack }: Props): ReactNode {
  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [latest, setLatest] = useState<ScanJob | null>(null);
  const [plan, setPlan] = useState<ScanPlan | null>(null);
  const [busy, setBusy] = useState<"idle" | "edit" | "scan" | "file">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ create: string[]; into: string[]; library: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; roots?: ScanRoot[]; latest?: ScanJob | null; plan?: ScanPlan | null }>(
      apiBase,
      "/api/historical-scan",
    )
      .then((j) => {
        if (cancelled || !j.ok) {
          return;
        }
        setRoots(j.roots ?? []);
        setLatest(j.latest ?? null);
        setPlan(j.plan ?? null);
      })
      .catch(() => {
        /* 打不开时不编造上次结果 */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  function clearLook(): void {
    setLatest(null);
    setPlan(null);
    setPicked(null);
  }

  async function addRoot(absPath: string): Promise<void> {
    setBusy("edit");
    setHint(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; error?: string; roots?: ScanRoot[] }, { absPath: string }>(
        apiBase,
        "/api/historical-scan/roots",
        "POST",
        { absPath },
      );
      if (!j.ok) {
        setHint(rootError(j.error));
        return;
      }
      setRoots(j.roots ?? []);
      clearLook();
    } catch (e) {
      setHint(errorMessage(e, "没能添加这个文件夹。"));
    } finally {
      setBusy("idle");
    }
  }

  async function pickAndAdd(): Promise<void> {
    const picked = await window.lawmindDesktop?.pickFolder?.();
    if (picked?.ok && picked.path) {
      await addRoot(picked.path);
    }
  }

  async function removeRoot(rootId: string): Promise<void> {
    setBusy("edit");
    setHint(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; roots?: ScanRoot[] }, { rootId: string }>(
        apiBase,
        "/api/historical-scan/roots/remove",
        "POST",
        { rootId },
      );
      if (!j.ok) {
        setHint("没能移除这个文件夹。");
        return;
      }
      setRoots(j.roots ?? []);
      clearLook();
    } catch (e) {
      setHint(errorMessage(e, "没能移除这个文件夹。"));
    } finally {
      setBusy("idle");
    }
  }

  async function runScan(): Promise<void> {
    setBusy("scan");
    setHint(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; job?: ScanJob; plan?: ScanPlan | null; error?: string },
        Record<string, never>
      >(apiBase, "/api/historical-scan/run", "POST", {});
      if (!j.ok) {
        setHint("这次没能看完。文件夹还在，可以再试一次。");
        return;
      }
      setLatest(j.job ?? null);
      setPlan(j.plan ?? null);
      setPicked(null);
      const cataloged = j.job?.stats?.cataloged ?? 0;
      setHint(cataloged > 0 ? "看完了。勾选要做的事，确认后才复制。" : "这些位置里没有找到可整理的文件。");
    } catch (e) {
      setHint(errorMessage(e, "这次没能整理完。"));
    } finally {
      setBusy("idle");
    }
  }

  const defaultPicks = {
    create: plan?.createMatters.map((row) => row.label) ?? [],
    into: plan?.intoMatters.map((row) => row.matterId) ?? [],
    library: plan?.library.map((row) => row.kind) ?? [],
  };
  const picks = picked ?? defaultPicks;
  const pickCount = picks.create.length + picks.into.length + picks.library.length;

  function toggle(group: "create" | "into" | "library", id: string): void {
    const base = picked ?? defaultPicks;
    const next = base[group].includes(id) ? base[group].filter((item) => item !== id) : [...base[group], id];
    setPicked({ ...base, [group]: next });
  }

  async function useCommonPlaces(): Promise<void> {
    setBusy("edit");
    setHint(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; roots?: ScanRoot[] }, Record<string, never>>(
        apiBase,
        "/api/historical-scan/common-places",
        "POST",
        {},
      );
      if (!j.ok) {
        setHint("没能改成桌面、文稿和下载。");
        return;
      }
      setRoots(j.roots ?? []);
      clearLook();
      setHint(j.roots && j.roots.length > 0 ? "已改为桌面、文稿和下载。再点查看。" : "这台电脑上没有找到这些文件夹。");
    } catch (e) {
      setHint(errorMessage(e, "没能改成桌面、文稿和下载。"));
    } finally {
      setBusy("idle");
    }
  }

  async function fileSelected(): Promise<void> {
    if (pickCount === 0) {
      return;
    }
    setBusy("file");
    setHint(null);
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          error?: string;
          hint?: string;
          copied?: number;
          created?: number;
          truncated?: boolean;
          plan?: ScanPlan | null;
        },
        { createLabels: string[]; intoMatterIds: string[]; libraryKinds: string[] }
      >(apiBase, "/api/historical-scan/apply", "POST", {
        createLabels: picks.create,
        intoMatterIds: picks.into,
        libraryKinds: picks.library,
      });
      if (!j.ok) {
        setHint(j.hint ?? "还没能整理。");
        return;
      }
      const parts = [
        `已整理。新建 ${j.created ?? 0} 个案件，复制 ${j.copied ?? 0} 份。电脑上的原文件没有改。`,
      ];
      if (picks.library.length > 0) {
        parts.push("一般资料按类型放在资料库。");
      }
      if (j.truncated) {
        parts.push("材料很多，这次先处理了前面一部分。");
      }
      setPlan(j.plan ?? plan);
      setPicked(null);
      setHint(parts.join(""));
    } catch (e) {
      setHint(errorMessage(e, "还没能整理。"));
    } finally {
      setBusy("idle");
    }
  }

  const habits = latest?.stats?.habitsQueued ?? 0;
  const unchanged =
    latest?.stats?.incremental === true && (latest.stats.filesChanged ?? 0) === 0 && (latest.stats.cataloged ?? 0) > 0;

  return (
    <div className="lm-archive-page lm-scroll" data-testid="lm-archive-organize">
      <div className="lm-archive-page-inner">
      <header className="lm-archive-page-header">
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          data-testid="lm-archive-organize-back"
          onClick={() => (onBack ?? requestReturnFromArchiveOrganize)()}
        >
          返回设置
        </button>
        <h1 className="lm-archive-page-title">整理电脑上的资料</h1>
        <p className="lm-archive-lead">
          看你指定的范围：该建案就建案，该归进已有案件就归进去，一般资料按类型收好。确认后才复制。不扫系统目录，文件内容不发给模型。
        </p>
      </header>
      <div className="lm-callout lm-callout-muted" role="note">
        <p className="lm-callout-body">
          范围可以是某一个文件夹，也可以是这台电脑上的桌面、文稿和下载。判断只看文件夹名和文件名，对照你已经有的案件。原文件留在原地。
        </p>
      </div>

      <section className="lm-archive-panel" aria-label="指定范围">
        <p className="lm-archive-step-kicker">第一步</p>
        <h2 className="lm-archive-results-title">指定范围</h2>
        <p className="lm-settings-caption">选一个目录，或改成桌面、文稿和下载。不进入系统目录和密钥。</p>
        {roots.length > 0 ? (
          <ul className="lm-archive-folders" data-testid="lm-archive-organize-roots">
            {roots.map((root) => (
              <li key={root.id} className="lm-archive-folder" title={root.absPath}>
                <span>{folderName(root)}</span>
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  disabled={busy !== "idle"}
                  data-testid="lm-archive-organize-remove"
                  onClick={() => void removeRoot(root.id)}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lm-archive-empty">还没有选择文件夹。</p>
        )}
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy !== "idle" || !window.lawmindDesktop?.pickFolder}
            data-testid="lm-archive-organize-pick"
            onClick={() => void pickAndAdd()}
          >
            选择文件夹
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy !== "idle"}
            data-testid="lm-archive-organize-common"
            onClick={() => void useCommonPlaces()}
          >
            桌面、文稿和下载
          </button>
        </div>
        {!window.lawmindDesktop?.pickFolder ? (
          <p className="lm-settings-caption">请在 LawMind 桌面版里选择文件夹。</p>
        ) : null}
      </section>

      <section className="lm-archive-panel" aria-label="查看结果" data-testid="lm-archive-organize-result">
        <p className="lm-archive-step-kicker">第二步</p>
        <h2 className="lm-archive-results-title">
          {latest?.stats
            ? unchanged
              ? "和上次相比，没有新材料"
              : `看过 ${latest.stats.cataloged ?? 0} 份`
            : "查看并分类"}
        </h2>
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            disabled={busy !== "idle" || roots.length === 0}
            data-testid="lm-archive-organize-run"
            onClick={() => void runScan()}
          >
            {busy === "scan" ? "查看中…" : "查看这些文件夹"}
          </button>
        </div>
        {latest?.stats && plan ? (
          <>
            <h3 className="lm-archive-group-title">新建案件</h3>
            {plan.createMatters.length > 0 ? (
              <ul className="lm-archive-matters">
                {plan.createMatters.map((row) => (
                  <li key={row.label}>
                    <label>
                      <input
                        type="checkbox"
                        checked={picks.create.includes(row.label)}
                        disabled={busy !== "idle"}
                        data-testid="lm-archive-organize-create"
                        onChange={() => toggle("create", row.label)}
                      />
                      <span>
                        {row.label}
                        <span className="lm-archive-matter-count"> · {row.count} 份</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lm-settings-caption">这次没有要新建的案件。</p>
            )}
            <h3 className="lm-archive-group-title">收进已有案件</h3>
            {plan.intoMatters.length > 0 ? (
              <ul className="lm-archive-matters">
                {plan.intoMatters.map((row) => (
                  <li key={row.matterId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={picks.into.includes(row.matterId)}
                        disabled={busy !== "idle"}
                        data-testid="lm-archive-organize-into"
                        onChange={() => toggle("into", row.matterId)}
                      />
                      <span>
                        {row.displayName}
                        <span className="lm-archive-matter-count"> · {row.count} 份</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lm-settings-caption">这次没有能对上已有案件的文件。</p>
            )}
            <h3 className="lm-archive-group-title">一般资料</h3>
            {plan.library.length > 0 ? (
              <ul className="lm-archive-matters">
                {plan.library.map((row) => (
                  <li key={row.kind}>
                    <label>
                      <input
                        type="checkbox"
                        checked={picks.library.includes(row.kind)}
                        disabled={busy !== "idle"}
                        data-testid="lm-archive-organize-library"
                        onChange={() => toggle("library", row.kind)}
                      />
                      <span>
                        {row.label}
                        <span className="lm-archive-matter-count"> · {row.count} 份</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lm-settings-caption">这次没有需要另放的一般资料。</p>
            )}
            {latest.stats.truncated ? (
              <p className="lm-settings-caption">材料很多，这次先看了前面一部分。</p>
            ) : null}
            {habits > 0 ? (
              <p className="lm-settings-caption">有些改法重复出现，已放到记忆里，等你确认后才记住。</p>
            ) : null}
          </>
        ) : (
          <p className="lm-settings-caption">指定范围后点查看。结果会分成新建案件、收进已有案件、一般资料。</p>
        )}
      </section>

      <section className="lm-archive-panel" aria-label="确认整理">
        <p className="lm-archive-step-kicker">第三步</p>
        <h2 className="lm-archive-results-title">确认后整理</h2>
        <p className="lm-settings-caption">只处理勾选的项。复制进案件或资料库，电脑上的原文件不改、不删。</p>
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            disabled={busy !== "idle" || pickCount === 0}
            data-testid="lm-archive-organize-file"
            onClick={() => void fileSelected()}
          >
            {busy === "file" ? "整理中…" : "按勾选整理"}
          </button>
        </div>
      </section>

      {hint ? (
        <p className="lm-settings-caption" role="status">
          {hint}
        </p>
      ) : null}
      </div>
    </div>
  );
}
