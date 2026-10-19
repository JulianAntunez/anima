-- Registro del huésped desde su teléfono. Pegar completo en Supabase > SQL Editor > Run (se puede ejecutar varias veces).
-- Requiere haber ejecutado antes schema.sql y huespedes.sql.
--
-- Cómo funciona: el recepcionista crea una invitación (enlace/QR de un solo uso, vence a los 15 minutos).
-- El huésped abre el enlace en su teléfono, acepta el consentimiento y se saca una selfie. El teléfono calcula
-- el vector facial y lo envía con la función registrar_con_invitacion; nunca se sube ninguna foto.
-- El teléfono no inicia sesión: solo puede llamar a las dos funciones de abajo y únicamente con un código válido.

-- Vector facial de 512 valores (se usa para reconocer al huésped desde cualquier equipo con sesión iniciada).
alter table public.huespedes add column if not exists embedding real[];
alter table public.huespedes drop constraint if exists huespedes_embedding_largo;
alter table public.huespedes add constraint huespedes_embedding_largo
  check (embedding is null or array_length(embedding, 1) = 512);

create table if not exists public.invitaciones (
  token text primary key check (char_length(token) between 24 and 64),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nombre text not null check (char_length(nombre) between 1 and 120),
  habitacion text not null default '',
  estadia text not null default '',
  creada timestamptz not null default now(),
  expira timestamptz not null default now() + interval '15 minutes',
  usada timestamptz
);

alter table public.invitaciones enable row level security;

drop policy if exists invitaciones_ver on public.invitaciones;
create policy invitaciones_ver on public.invitaciones for select to authenticated
  using (user_id = auth.uid());
drop policy if exists invitaciones_insertar on public.invitaciones;
create policy invitaciones_insertar on public.invitaciones for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists invitaciones_borrar on public.invitaciones;
create policy invitaciones_borrar on public.invitaciones for delete to authenticated
  using (user_id = auth.uid());

-- Devuelve el nombre de la invitación si el código es válido (no usado y no vencido); si no, null.
create or replace function public.invitacion_nombre(p_token text) returns text
language sql stable security definer set search_path = public as $$
  select nombre from public.invitaciones
  where token = p_token and usada is null and expira > now();
$$;

-- Registra al huésped con el vector enviado desde el teléfono. Devuelve false si el código no sirve.
create or replace function public.registrar_con_invitacion(p_token text, p_embedding real[]) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  inv public.invitaciones%rowtype;
  v_id uuid;
begin
  if p_embedding is null or array_length(p_embedding, 1) <> 512 then
    raise exception 'vector invalido';
  end if;

  select * into inv from public.invitaciones
  where token = p_token and usada is null and expira > now()
  for update;
  if not found then
    return false;
  end if;

  -- Si ya existe un huésped con ese nombre en este hotel, se actualiza en lugar de duplicarlo.
  update public.huespedes
     set embedding = p_embedding, habitacion = inv.habitacion, estadia = inv.estadia, consentimiento_ts = now()
   where user_id = inv.user_id and lower(nombre) = lower(inv.nombre)
   returning id into v_id;

  if v_id is null then
    insert into public.huespedes (id, user_id, nombre, habitacion, estadia, embedding, consentimiento_ts)
    values (gen_random_uuid(), inv.user_id, inv.nombre, inv.habitacion, inv.estadia, p_embedding, now());
  end if;

  update public.invitaciones set usada = now() where token = p_token;
  return true;
end $$;

revoke all on function public.invitacion_nombre(text) from public;
revoke all on function public.registrar_con_invitacion(text, real[]) from public;
grant execute on function public.invitacion_nombre(text) to anon, authenticated;
grant execute on function public.registrar_con_invitacion(text, real[]) to anon, authenticated;
