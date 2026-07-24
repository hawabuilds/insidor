-- Narrative display gate — meme_score from posts + explicit gate_reason

alter table public.narratives
  add column if not exists meme_score numeric,
  add column if not exists max_meme_score numeric,
  add column if not exists gate_reason text;

create index if not exists narratives_gate_reason_idx
  on public.narratives (gate_reason)
  where source = 'cluster';
