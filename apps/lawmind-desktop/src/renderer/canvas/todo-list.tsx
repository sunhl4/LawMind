import type { CSSProperties } from "react";
import { canvasTypography } from "./tokens";
import { useCanvasTheme } from "./theme";
import { Card, CardBody, CardHeader, mergeStyle } from "./primitives";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

function TodoMark(props: { status: TodoStatus }) {
  const theme = useCanvasTheme();
  const color =
    props.status === "completed"
      ? theme.stat.success
      : props.status === "in_progress"
        ? theme.accent.primary
        : props.status === "cancelled"
          ? theme.text.quaternary
          : theme.text.tertiary;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }}>
      <circle cx="7" cy="7" r="5.2" fill="none" stroke={color} strokeWidth="1.3" />
      {props.status === "completed" ? (
        <path d="M4.2 7.1 6.1 9 9.8 4.8" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
      ) : null}
      {props.status === "in_progress" ? <circle cx="7" cy="7" r="2.1" fill={color} /> : null}
      {props.status === "cancelled" ? (
        <path d="M4.6 4.6 9.4 9.4M9.4 4.6 4.6 9.4" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

export function TodoList(props: {
  todos: readonly TodoItem[];
  dimmedTodoIds?: ReadonlySet<string>;
  onTodoClick?: (todo: TodoItem) => void;
  style?: CSSProperties;
}) {
  const theme = useCanvasTheme();
  if (props.todos.length === 0) {
    return null;
  }
  return (
    <div style={props.style}>
      {props.todos.map((todo) => {
        const dimmed = props.dimmedTodoIds?.has(todo.id) || todo.status === "cancelled";
        return (
          <button
            key={todo.id}
            type="button"
            onClick={() => props.onTodoClick?.(todo)}
            style={{
              display: "flex",
              gap: 8,
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "transparent",
              padding: "6px 2px",
              cursor: props.onTodoClick ? "pointer" : "default",
              font: "inherit",
              opacity: dimmed ? 0.45 : 1,
            }}
          >
            <TodoMark status={todo.status} />
            <span
              style={{
                ...canvasTypography.body,
                color: todo.status === "completed" ? theme.text.tertiary : theme.text.primary,
                textDecoration: todo.status === "cancelled" ? "line-through" : "none",
              }}
            >
              {todo.content}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TodoListCard(props: {
  todos: readonly TodoItem[];
  dimmedTodoIds?: ReadonlySet<string>;
  defaultExpanded?: boolean;
  onTodoClick?: (todo: TodoItem) => void;
  style?: CSSProperties;
}) {
  if (props.todos.length === 0) {
    return null;
  }
  const done = props.todos.filter((todo) => todo.status === "completed").length;
  return (
    <Card collapsible defaultOpen={props.defaultExpanded ?? true} style={props.style}>
      <CardHeader>{`${done} of ${props.todos.length} Done`}</CardHeader>
      <CardBody style={mergeStyle({ padding: "4px 8px 8px" })}>
        <TodoList todos={props.todos} dimmedTodoIds={props.dimmedTodoIds} onTodoClick={props.onTodoClick} />
      </CardBody>
    </Card>
  );
}
