-- Ejecutar en SQL Editor de Supabase. NO introducir service_role en el frontend.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null unique check (char_length(trim(nickname)) between 3 and 24),
 created_at timestamptz not null default now()
);
create table if not exists public.matches (
 id bigint generated always as identity primary key,
 round_no int not null check (round_no > 0),
 player1 uuid not null references public.profiles(id),
 player2 uuid not null references public.profiles(id),
 score1 int, score2 int,
 status text not null default 'scheduled' check(status in ('scheduled','pending','confirmed')),
 reported_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 check(player1 <> player2),
 check ((status='scheduled' and score1 is null and score2 is null and reported_by is null)
     or (status in ('pending','confirmed') and score1 between 0 and 3 and score2 between 0 and 3 and ((score1=3 and score2<3) or (score2=3 and score1<3)) and reported_by is not null)),
 unique(player1,player2)
);
create table if not exists public.admins (id uuid primary key references auth.users(id) on delete cascade);
create index if not exists matches_player1_idx on public.matches(player1);
create index if not exists matches_player2_idx on public.matches(player2);

create or replace function public.register_player(p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Debés iniciar sesión'; end if;
 if length(trim(p_nickname)) not between 3 and 24 then raise exception 'El apodo debe tener entre 3 y 24 caracteres'; end if;
 insert into public.profiles(id,nickname) values(auth.uid(),trim(p_nickname))
 on conflict (id) do nothing;
end $$;

create or replace function public.report_match(p_match_id bigint,p_score1 int,p_score2 int)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.matches%rowtype;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión'; end if;
 select * into m from public.matches where id=p_match_id for update;
 if not found then raise exception 'Partida inexistente'; end if;
 if auth.uid() not in (m.player1,m.player2) then raise exception 'No participás en esta partida'; end if;
 if m.status='confirmed' then raise exception 'El resultado ya está confirmado'; end if;
 if not ((p_score1=3 and p_score2 between 0 and 2) or (p_score2=3 and p_score1 between 0 and 2)) then
  raise exception 'Al mejor de cinco: 3-0, 3-1 o 3-2';
 end if;
 update public.matches set score1=p_score1,score2=p_score2,status='pending',reported_by=auth.uid() where id=p_match_id;
end $$;

create or replace function public.confirm_match(p_match_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.matches%rowtype;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión'; end if;
 select * into m from public.matches where id=p_match_id for update;
 if not found or m.status <> 'pending' then raise exception 'No hay resultado pendiente'; end if;
 if auth.uid() not in (m.player1,m.player2) or auth.uid()=m.reported_by then
  raise exception 'Solo el rival puede confirmar';
 end if;
 update public.matches set status='confirmed' where id=p_match_id;
end $$;

create or replace function public.create_round_robin()
returns integer language plpgsql security definer set search_path = '' as $$
declare ids uuid[]; n int; i int; j int; inserted_count int := 0;
begin
 if not exists(select 1 from public.admins where id=auth.uid()) then raise exception 'Solo administradores'; end if;
 if exists(select 1 from public.matches) then raise exception 'Ya existe un calendario; esta versión solo admite una temporada'; end if;
 select array_agg(id order by created_at,id) into ids from public.profiles;
 n:=coalesce(array_length(ids,1),0);
 if n<2 then raise exception 'Se necesitan al menos 2 jugadores'; end if;
 for i in 1..n-1 loop
  for j in i+1..n loop
   insert into public.matches(round_no,player1,player2) values(i,ids[i],ids[j]);
   inserted_count:=inserted_count+1;
  end loop;
 end loop;
 return inserted_count;
end $$;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.admins enable row level security;
-- Los perfiles y marcadores son públicos para poder mostrar la tabla.
create policy "profiles public read" on public.profiles for select to anon,authenticated using (true);
create policy "matches public read" on public.matches for select to anon,authenticated using (true);
create policy "admins self read" on public.admins for select to authenticated using (id=auth.uid());
-- No hay políticas de escritura directa: únicamente funciones RPC verificadas.
revoke all on function public.register_player(text) from public;
revoke all on function public.report_match(bigint,int,int) from public;
revoke all on function public.confirm_match(bigint) from public;
revoke all on function public.create_round_robin() from public;
grant execute on function public.register_player(text) to authenticated;
grant execute on function public.report_match(bigint,int,int) to authenticated;
grant execute on function public.confirm_match(bigint) to authenticated;
grant execute on function public.create_round_robin() to authenticated;
