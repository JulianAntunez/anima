-- Esquema para la recepción del hotel. Pegar completo en Supabase > SQL Editor > Run.
-- Solo guarda datos anónimos y resumidos (emoción, confianza, horarios). Nunca imágenes ni vectores faciales.

create table if not exists public.perfiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rol text not null default 'recepcionista' check (rol in ('recepcionista', 'gerente'))
);

create table if not exists public.episodios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ref bigint,
  inicio timestamptz not null,
  fin timestamptz not null,
  duracion_ms integer not null check (duracion_ms >= 0),
  dominante text not null check (dominante in ('neutral','feliz','sorprendido','triste','enojado','asco','miedo')),
  alerta boolean not null default false
);

create table if not exists public.registros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ts timestamptz not null,
  emocion text not null check (emocion in ('neutral','feliz','sorprendido','triste','enojado','asco','miedo')),
  confianza real not null check (confianza between 0 and 1),
  episodio bigint
);

create index if not exists registros_ts_idx on public.registros (ts);
create index if not exists episodios_inicio_idx on public.episodios (inicio);

-- Cada usuario nuevo recibe el rol de recepcionista automáticamente.
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

create or replace function public.es_gerente() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where user_id = auth.uid() and rol = 'gerente');
$$;

-- Seguridad por filas: sin sesión no se puede nada.
alter table public.perfiles enable row level security;
alter table public.episodios enable row level security;
alter table public.registros enable row level security;

drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles for select to authenticated
  using (user_id = auth.uid() or public.es_gerente());

drop policy if exists episodios_ver on public.episodios;
create policy episodios_ver on public.episodios for select to authenticated
  using (user_id = auth.uid() or public.es_gerente());
drop policy if exists episodios_insertar on public.episodios;
create policy episodios_insertar on public.episodios for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists episodios_borrar on public.episodios;
create policy episodios_borrar on public.episodios for delete to authenticated
  using (user_id = auth.uid() or public.es_gerente());

drop policy if exists registros_ver on public.registros;
create policy registros_ver on public.registros for select to authenticated
  using (user_id = auth.uid() or public.es_gerente());
drop policy if exists registros_insertar on public.registros;
create policy registros_insertar on public.registros for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists registros_borrar on public.registros;
create policy registros_borrar on public.registros for delete to authenticated
  using (user_id = auth.uid() or public.es_gerente());

-- Para dar el rol de gerente a un usuario (reemplazar el correo):
-- update public.perfiles set rol = 'gerente'
--   where user_id = (select id from auth.users where email = 'gerente@hotel.com');
