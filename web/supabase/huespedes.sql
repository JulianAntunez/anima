-- Huéspedes y vista de atenciones. Pegar completo en Supabase > SQL Editor > Run (se puede ejecutar varias veces).
-- Guarda nombre, habitación, estadía y fecha del consentimiento. El vector facial NUNCA sale del navegador.

create table if not exists public.huespedes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 120),
  habitacion text not null default '',
  estadia text not null default '',
  consentimiento_ts timestamptz not null default now(),
  creado timestamptz not null default now()
);

create index if not exists huespedes_nombre_idx on public.huespedes (lower(nombre));

-- Cada atención puede quedar vinculada al huésped reconocido. Si el huésped se borra, la atención queda anónima.
alter table public.episodios
  add column if not exists huesped_id uuid references public.huespedes (id) on delete set null;
create index if not exists episodios_huesped_idx on public.episodios (huesped_id);

alter table public.huespedes enable row level security;

drop policy if exists huespedes_ver on public.huespedes;
create policy huespedes_ver on public.huespedes for select to authenticated
  using (user_id = auth.uid() or public.es_gerente());
drop policy if exists huespedes_insertar on public.huespedes;
create policy huespedes_insertar on public.huespedes for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists huespedes_actualizar on public.huespedes;
create policy huespedes_actualizar on public.huespedes for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists huespedes_borrar on public.huespedes;
create policy huespedes_borrar on public.huespedes for delete to authenticated
  using (user_id = auth.uid() or public.es_gerente());

-- Vista legible: una fila por atención, con el huésped, la hora local y la emoción en español.
-- security_invoker hace que respete las mismas reglas de acceso que las tablas.
create or replace view public.atenciones with (security_invoker = true) as
select
  e.inicio at time zone 'America/Argentina/Buenos_Aires' as fecha_hora,
  coalesce(h.nombre, 'Cliente sin registrar') as huesped,
  h.habitacion,
  h.estadia,
  case e.dominante
    when 'feliz' then 'Satisfecho'
    when 'neutral' then 'Tranquilo'
    when 'sorprendido' then 'Sorprendido'
    when 'triste' then 'Preocupado'
    when 'enojado' then 'Molesto'
    when 'asco' then 'Incómodo'
    when 'miedo' then 'Inquieto'
    else e.dominante
  end as animo,
  round(e.duracion_ms / 1000.0) as segundos,
  case when e.alerta then 'Sí' else 'No' end as alerta
from public.episodios e
left join public.huespedes h on h.id = e.huesped_id
order by e.inicio desc;

grant select on public.atenciones to authenticated;
