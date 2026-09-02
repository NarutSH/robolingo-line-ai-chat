-- New conversations start on the AI.
--
-- `manual` was the right default while no agent existed: it meant "a human will
-- read this", which was true. Now that the agent answers, leaving it would mean
-- every new customer waits for a person before anything happens.
--
-- Only the default changes. `ingest_line_message` inserts a conversation without
-- naming a mode, so it picks this up with no change to the function, and every
-- conversation that already exists keeps the mode it has.

alter table public.conversations
  alter column mode set default 'ai';

comment on column public.conversations.mode is
  'ai: the agent answers and an operator supervises. manual: only a human replies. '
  'Set to manual by the operator taking over, or by the agent handing off.';
