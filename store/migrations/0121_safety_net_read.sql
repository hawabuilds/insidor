-- 0121_safety_net_read.sql
--
-- WHAT THE OWNER'S "SECOND CHANCES" LIST MAY READ: the For You posts of the last two days that came
-- in through the coin model after the judge said no (0096's coin_model_score, would_add, live), with
-- their words, when they were first shown and a link. Read by services/social/src/owner.ts
-- (GET /owner/safety-net), as insidor_people.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The route joined internal.coin_model_score and internal.post_judgement itself, and insidor_people
-- holds no grant on either: 0096 says why — a probability is the system's own reasoning and never
-- reaches the app. On 2026-10-21 the social log showed `permission denied for table
-- coin_model_score` on every open of the list, so the owner's list never loaded.
--
-- Granting the role the tables would let the people service read every score and every judge
-- answer. Instead, as 0092's judge_lines: one `security definer` function with a fixed search_path,
-- executable by insidor_people only, that answers exactly what the list shows — which posts, when,
-- their words and a link — and never a score, a threshold or what the judge said.
--
-- What breaks if changed carelessly: the function's rows ARE the list. A column added here reaches
-- the owner's screen through the route; a score must never be one of them.

create function internal.safety_net_posts(p_since timestamptz, p_limit integer)
returns table (item_id text, shown_at timestamptz, body text, link text)
language sql
stable
security definer
set search_path = internal
as $$
  select f.item_id, f.first_shown_at, i.body,
         case i.source when 'x' then 'https://x.com/i/status/' || i.source_item_id
                       when 'tiktok' then 'https://www.tiktok.com/@' || coalesce(a.handle, '') || '/video/' || i.source_item_id end
    from public.feed_post f
    join internal.coin_model_score s on s.item_id = f.item_id and s.would_add and s.mode = 'live'
    join public.item i on i.item_id = f.item_id
    left join public.author a on a.author_key = i.author_key
    join lateral (select pj.coinable from internal.post_judgement pj
                   where pj.item_id = f.item_id and pj.prompt_id not like 'post-kind%'
                   order by pj.judged_at desc, pj.id desc limit 1) j on not j.coinable
   where f.feed_id = 'fyp' and f.first_shown_at >= p_since and f.first_shown_at >= s.scored_at
     and not exists (select 1 from internal.owner_feedback o where o.item_id = f.item_id and o.subject_kind = 'post' and o.verdict = 'meme')
   order by f.first_shown_at desc
   limit greatest(0, least(p_limit, 500));
$$;

revoke all on function internal.safety_net_posts(timestamptz, integer) from public;
grant execute on function internal.safety_net_posts(timestamptz, integer) to insidor_people;

comment on function internal.safety_net_posts(timestamptz, integer) is
  'The owner''s Second chances list: For You posts since a time that the coin model let in after a judge no, with their words, when first shown and a link. Never a score (0096). For services/social owner.ts.';
