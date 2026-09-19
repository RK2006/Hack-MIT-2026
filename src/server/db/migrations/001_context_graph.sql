CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE context_sources (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('manual', 'repository', 'agent')),
  uri text NOT NULL CHECK (char_length(uri) BETWEEN 1 AND 2048),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  excerpt text NOT NULL CHECK (char_length(excerpt) <= 20000),
  revision_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  CHECK ((kind = 'repository' AND revision_ref IS NOT NULL
          AND char_length(revision_ref) BETWEEN 1 AND 200)
    OR (kind IN ('manual', 'agent') AND revision_ref IS NULL
          AND char_length(excerpt) > 0))
);

CREATE TABLE context_nodes (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  type text NOT NULL CHECK (type IN
    ('component', 'file', 'decision', 'constraint', 'assumption', 'discovery', 'bug')),
  external_key text CHECK (char_length(external_key) BETWEEN 1 AND 200),
  path text CHECK (char_length(path) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  UNIQUE (project_id, external_key),
  UNIQUE (project_id, path),
  CHECK ((type = 'file' AND path IS NOT NULL) OR (type <> 'file' AND path IS NULL))
);

CREATE TABLE context_revisions (
  project_id uuid NOT NULL,
  node_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 20000),
  summary text NOT NULL CHECK (char_length(summary) <= 1000),
  authority text NOT NULL CHECK (authority IN ('canonical', 'inferred')),
  importance integer NOT NULL CHECK (importance BETWEEN 1 AND 5),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  archived boolean NOT NULL,
  source_id uuid NOT NULL,
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor) = 'object'),
  change_reason text NOT NULL CHECK (char_length(change_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, version),
  FOREIGN KEY (project_id, node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (project_id, source_id) REFERENCES context_sources(project_id, id)
);

CREATE TABLE context_edges (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('CONTAINS', 'DEPENDS_ON', 'IMPLEMENTS',
    'REQUIRES', 'CONSTRAINS', 'AFFECTS', 'CAUSED_BY', 'RELATED_TO')),
  authority text NOT NULL CHECK (authority IN ('canonical', 'inferred')),
  source_id uuid NOT NULL,
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, from_node_id, to_node_id, type),
  CHECK (from_node_id <> to_node_id),
  FOREIGN KEY (project_id, from_node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (project_id, to_node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (project_id, source_id) REFERENCES context_sources(project_id, id)
);

CREATE INDEX context_revisions_project_idx ON context_revisions(project_id);
CREATE INDEX context_edges_from_idx ON context_edges(project_id, from_node_id);
CREATE INDEX context_edges_to_idx ON context_edges(project_id, to_node_id);

