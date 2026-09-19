'use client';

export type TaskPanelProps = {
  projectId: string;
  selectedNodeId: string | null;
  graphVersion: number;
  onHighlight: (nodeIds: string[]) => void;
  onSelectNode: (nodeId: string) => void;
};

export default function TaskPanel(props: TaskPanelProps) {
  return (
    <section className="task-panel" aria-label="Task context">
      <h2>Task context</h2>
      <p className="muted">
        Task panel is integrated in the compiler feature. (project {props.projectId}, graph version{' '}
        {props.graphVersion})
      </p>
    </section>
  );
}
