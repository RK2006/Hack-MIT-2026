CREATE TABLE context_embeddings (
  project_id uuid NOT NULL,
  node_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  provider_model text NOT NULL CHECK (char_length(provider_model) BETWEEN 1 AND 200),
  dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 4096),
  vector double precision[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, version, provider_model),
  FOREIGN KEY (project_id, node_id) REFERENCES context_nodes(project_id, id),
  FOREIGN KEY (node_id, version) REFERENCES context_revisions(node_id, version)
);

CREATE INDEX context_embeddings_project_idx ON context_embeddings(project_id, provider_model);
