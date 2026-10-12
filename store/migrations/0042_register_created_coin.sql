-- 0042_register_created_coin.sql
--
-- HOW A COIN CREATED THROUGH INSIDOR IS RECORDED (0040's table), AND BY WHOM.
--
-- The trade service, after the create transaction has landed and it has checked that on the
-- chain, records the coin so it shows "Created on Insidor" and appears under the creator's
-- "Coins you created". That service holds the app role, which never writes; it is granted EXECUTE
-- on this function and nothing else on the table. The function inserts one row, once — a coin
-- already recorded is left exactly as it was — and refuses anything that is not an address or a
-- signature. It cannot change or remove a row.

create function public.register_created_coin(p_address text, p_creator text, p_story_id text, p_signature text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or p_creator !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  if p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$' then return; end if;
  insert into public.created_coin (address, creator, story_id, signature, created_at)
  values (p_address, p_creator, nullif(left(p_story_id, 200), ''), p_signature, now())
  on conflict (address) do nothing;
end;
$$;

revoke all on function public.register_created_coin(text, text, text, text) from public;
grant execute on function public.register_created_coin(text, text, text, text) to insidor_app;
