-- Enable Supabase Realtime on narratives (run once in SQL editor).
-- Dashboard alternative: Database → Replication → supabase_realtime → add narratives.

alter table public.narratives replica identity full;

alter table public.narrative_posts replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.narratives;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.narrative_posts;
exception
  when duplicate_object then null;
end $$;
