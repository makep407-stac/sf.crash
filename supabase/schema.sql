-- AQar DZ schema. This file mirrors the schema already applied to Supabase.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'عضو عقار DZ',
  avatar_url text,
  bio text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  deal_type text not null check (deal_type in ('sale','rent')),
  property_type text not null,
  price numeric(14,2) not null check (price >= 0),
  currency text not null default 'DZD' check (currency = 'DZD'),
  wilaya_code text,
  wilaya_name text not null,
  daira_name text,
  commune_name text,
  address text,
  area_m2 numeric(10,2) check (area_m2 is null or area_m2 > 0),
  bedrooms integer check (bedrooms is null or bedrooms >= 0),
  bathrooms integer check (bathrooms is null or bathrooms >= 0),
  image_urls text[] not null default '{}',
  status text not null default 'published' check (status in ('draft','published','archived','sold','rented')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listings_public_search_idx on public.listings (status, deal_type, wilaya_code, property_type, price);
create index if not exists listings_user_created_idx on public.listings (user_id, created_at desc);
create index if not exists listings_daira_idx on public.listings (wilaya_name, daira_name, commune_name);

create table if not exists public.listing_likes (
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index if not exists listing_likes_user_idx on public.listing_likes (user_id);

create table if not exists public.listing_saves (
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
create index if not exists listing_saves_user_idx on public.listing_saves (user_id);

create table if not exists public.listing_comments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists listing_comments_listing_idx on public.listing_comments (listing_id, created_at);
create index if not exists listing_comments_user_idx on public.listing_comments (user_id);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists direct_messages_conversation_idx on public.direct_messages (sender_id, recipient_id, created_at desc);
create index if not exists direct_messages_listing_idx on public.direct_messages (listing_id);
create index if not exists direct_messages_recipient_idx on public.direct_messages (recipient_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.listing_likes enable row level security;
alter table public.listing_saves enable row level security;
alter table public.listing_comments enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "Public can read safe profile fields" on public.profiles;
create policy "Public can read safe profile fields" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Anyone can view published listings" on public.listings;
create policy "Anyone can view published listings" on public.listings for select to anon, authenticated using (status = 'published' or (select auth.uid()) = user_id);
drop policy if exists "Signed-in users can create own listings" on public.listings;
create policy "Signed-in users can create own listings" on public.listings for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can update own listings" on public.listings;
create policy "Owners can update own listings" on public.listings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owners can delete own listings" on public.listings;
create policy "Owners can delete own listings" on public.listings for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can read listing likes" on public.listing_likes;
create policy "Anyone can read listing likes" on public.listing_likes for select to anon, authenticated using (true);
drop policy if exists "Users can like as themselves" on public.listing_likes;
create policy "Users can like as themselves" on public.listing_likes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can remove own likes" on public.listing_likes;
create policy "Users can remove own likes" on public.listing_likes for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own saved listings" on public.listing_saves;
create policy "Users can read own saved listings" on public.listing_saves for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can save as themselves" on public.listing_saves;
create policy "Users can save as themselves" on public.listing_saves for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can unsave own listings" on public.listing_saves;
create policy "Users can unsave own listings" on public.listing_saves for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can read comments on visible listings" on public.listing_comments;
create policy "Anyone can read comments on visible listings" on public.listing_comments for select to anon, authenticated using (exists (select 1 from public.listings l where l.id = listing_id and (l.status = 'published' or l.user_id = (select auth.uid()))));
drop policy if exists "Users can comment as themselves" on public.listing_comments;
create policy "Users can comment as themselves" on public.listing_comments for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.listings l where l.id = listing_id and l.status = 'published'));
drop policy if exists "Users can delete own comments" on public.listing_comments;
create policy "Users can delete own comments" on public.listing_comments for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Participants can read messages" on public.direct_messages;
create policy "Participants can read messages" on public.direct_messages for select to authenticated using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);
drop policy if exists "Senders can send messages as themselves" on public.direct_messages;
create policy "Senders can send messages as themselves" on public.direct_messages for insert to authenticated with check ((select auth.uid()) = sender_id);
drop policy if exists "Recipients can mark messages read" on public.direct_messages;
create policy "Recipients can mark messages read" on public.direct_messages for update to authenticated using ((select auth.uid()) = recipient_id) with check ((select auth.uid()) = recipient_id);

grant usage on schema public to anon, authenticated;
grant select on public.listings, public.listing_likes, public.listing_comments to anon, authenticated;
grant insert, update, delete on public.listings to authenticated;
grant insert, delete on public.listing_likes to authenticated;
grant select, insert, delete on public.listing_saves to authenticated;
grant insert, delete on public.listing_comments to authenticated;
grant select, insert on public.direct_messages to authenticated;
grant update (read_at) on public.direct_messages to authenticated;
revoke select on public.profiles from anon, authenticated;
grant select (user_id, display_name, avatar_url, bio, created_at) on public.profiles to anon, authenticated;
grant insert (user_id, display_name, avatar_url, bio, phone) on public.profiles to authenticated;
grant update (display_name, avatar_url, bio, phone, updated_at) on public.profiles to authenticated;

create or replace function public.handle_new_aqar_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'عضو عقار DZ'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_aqar_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_aqar_profile on auth.users;
create trigger on_auth_user_created_aqar_profile after insert on auth.users
for each row execute function public.handle_new_aqar_profile();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "Public can view listing images" on storage.objects;
create policy "Public can view listing images" on storage.objects for select to anon, authenticated using (bucket_id = 'listing-images');
drop policy if exists "Authenticated users upload listing images to own folder" on storage.objects;
create policy "Authenticated users upload listing images to own folder" on storage.objects for insert to authenticated with check (bucket_id = 'listing-images' and (storage.foldername(name))[1] = (select auth.uid()::text));
drop policy if exists "Users update own listing images" on storage.objects;
create policy "Users update own listing images" on storage.objects for update to authenticated using (bucket_id = 'listing-images' and owner_id = (select auth.uid()::text)) with check (bucket_id = 'listing-images' and owner_id = (select auth.uid()::text));
drop policy if exists "Users delete own listing images" on storage.objects;
create policy "Users delete own listing images" on storage.objects for delete to authenticated using (bucket_id = 'listing-images' and owner_id = (select auth.uid()::text));
