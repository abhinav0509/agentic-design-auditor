-- Audit log tamper-evidence (addendum 2.8, D-036): proposal_events form one hash chain per org,
-- computed here on insert so no writer can skip or forge a link. Whatever hash a writer supplies is
-- overwritten. Contract for verifiers, per org in id order:
--   prev_hash = previous event's hash (null for the first)
--   hash = sha256(coalesce(prev_hash, '') || utf8(jsonb_build_object(<row>, created_at in UTC)::text))
create function chain_proposal_event() returns trigger language plpgsql as $$
begin
  -- One writer per org at a time. The two-int key space never overlaps migrate()'s bigint lock.
  perform pg_advisory_xact_lock(1, hashtext(new.org_id::text));
  -- The identity default ran before this lock; take a new id so id order is chain order.
  new.id := nextval(pg_get_serial_sequence('proposal_events', 'id'));
  select e.hash into new.prev_hash from proposal_events e
    where e.org_id = new.org_id order by e.id desc limit 1;
  new.hash := sha256(coalesce(new.prev_hash, ''::bytea) || convert_to(jsonb_build_object(
    'id', new.id, 'org_id', new.org_id, 'proposal_id', new.proposal_id,
    'from_status', new.from_status, 'to_status', new.to_status, 'actor_type', new.actor_type,
    'actor_id', new.actor_id, 'reason', new.reason, 'data', new.data,
    'created_at', new.created_at at time zone 'UTC')::text, 'UTF8'));
  return new;
end $$;

create trigger proposal_events_hash_chain before insert on proposal_events
  for each row execute function chain_proposal_event();
