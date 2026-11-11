-- DARNA production-ready starting schema for Supabase.
-- Run this in Supabase SQL Editor after creating the project.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.phone
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    phone = excluded.phone,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of phone on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 8 and 140),
  description text not null default '',
  deal_type text not null check (deal_type in ('بيع','كراء')),
  property_type text not null check (property_type in ('شقة','فيلا','أرض','محل','مكتب','مستودع','أخرى')),
  price numeric(16,2) not null check (price >= 0),
  currency text not null default 'DZD',
  wilaya_code integer not null check (wilaya_code between 1 and 69),
  wilaya_name text not null,
  daira_name text not null,
  commune_name text not null,
  address text not null default '',
  area_m2 numeric(10,2),
  bedrooms integer not null default 0 check (bedrooms >= 0),
  bathrooms integer not null default 0 check (bathrooms >= 0),
  image_urls text[] not null default '{}',
  status text not null default 'active' check (status in ('draft','active','pending','rejected','sold','rented')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listings_search_idx on public.listings (status, wilaya_code, deal_type, property_type, created_at desc);
create index if not exists listings_daira_idx on public.listings (wilaya_name, daira_name, commune_name);

create table if not exists public.listing_likes (
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

create table if not exists public.listing_saves (
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);

create table if not exists public.listing_comments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists direct_messages_pair_idx on public.direct_messages (sender_id, recipient_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_likes enable row level security;
alter table public.listing_saves enable row level security;
alter table public.listing_comments enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "Public profiles are viewable" on public.profiles;
create policy "Public profiles are viewable" on public.profiles for select using (true);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Anyone reads active listings" on public.listings;
create policy "Anyone reads active listings" on public.listings for select using (status = 'active' or auth.uid() = user_id);
drop policy if exists "Users create own listings" on public.listings;
create policy "Users create own listings" on public.listings for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Owners update own listings" on public.listings;
create policy "Owners update own listings" on public.listings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Owners delete own listings" on public.listings;
create policy "Owners delete own listings" on public.listings for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Likes are publicly readable" on public.listing_likes;
create policy "Likes are publicly readable" on public.listing_likes for select using (true);
drop policy if exists "Users manage own likes" on public.listing_likes;
create policy "Users manage own likes" on public.listing_likes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Saves are private" on public.listing_saves;
create policy "Saves are private" on public.listing_saves for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users manage own saves" on public.listing_saves;
create policy "Users manage own saves" on public.listing_saves for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Comments are publicly readable" on public.listing_comments;
create policy "Comments are publicly readable" on public.listing_comments for select using (true);
drop policy if exists "Authenticated users comment" on public.listing_comments;
create policy "Authenticated users comment" on public.listing_comments for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users delete own comments" on public.listing_comments;
create policy "Users delete own comments" on public.listing_comments for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Message participants read" on public.direct_messages;
create policy "Message participants read" on public.direct_messages for select to authenticated using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "Sender creates own message" on public.direct_messages;
create policy "Sender creates own message" on public.direct_messages for insert to authenticated with check (auth.uid() = sender_id);
drop policy if exists "Recipient marks messages read" on public.direct_messages;
create policy "Recipient marks messages read" on public.direct_messages for update to authenticated using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.listings, public.listing_likes, public.listing_comments to anon, authenticated;
grant insert, update, delete on public.profiles, public.listings, public.listing_likes, public.listing_saves, public.listing_comments, public.direct_messages to authenticated;
grant select on public.listing_saves, public.direct_messages to authenticated;
