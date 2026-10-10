create table public.admin_push_config (
  id boolean primary key default true check (id),
  public_key text not null,
  private_key text not null
);
create table public.admin_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.admin_push_config enable row level security;
alter table public.admin_push_subscriptions enable row level security;
revoke all on public.admin_push_config, public.admin_push_subscriptions from public, anon, authenticated;
grant all on public.admin_push_config, public.admin_push_subscriptions to service_role;
