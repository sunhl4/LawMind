import type { ReactNode } from "react";

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lm-settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function SettingsGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="lm-settings-group">
      <span className="lm-settings-label">{label}</span>
      {children}
    </div>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="lm-settings-row">
      <div className="lm-settings-row-label">
        {label}
        {hint ? <span className="lm-settings-hint">{hint}</span> : null}
      </div>
      <div className="lm-settings-row-value">{children}</div>
    </div>
  );
}

export function SettingsSurface({ children }: { children: ReactNode }) {
  return <div className="lm-settings-surface">{children}</div>;
}
