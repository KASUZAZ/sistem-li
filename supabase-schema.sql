-- Sistem LI Supabase schema
-- Run this in Supabase Dashboard > SQL Editor after the project is created.

create table if not exists public.students (
  id text primary key,
  password text not null default 'Dkm2026',
  name text not null,
  program text not null default 'Diploma Kejuruteraan Mekanikal',
  company text not null default '',
  address text not null default '',
  industry_supervisor text not null default '',
  university_supervisor text not null default 'IZAH BINTI MD JEDI',
  start_date date not null,
  end_date date not null,
  photo_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weekly_logs (
  id bigserial primary key,
  student_id text not null references public.students(id) on delete cascade,
  week integer not null,
  start_date date not null,
  end_date date not null,
  activity text not null default '',
  learning text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved')),
  activity_image_url text not null default '',
  approved_by text not null default '',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, week)
);

create table if not exists public.signatures (
  student_id text primary key references public.students(id) on delete cascade,
  supervisor_name text not null default '',
  note text not null default '',
  signed_at timestamptz
);

create table if not exists public.users (
  id bigserial primary key,
  login text unique not null,
  password text not null,
  role text not null check (role in ('admin', 'supervisor')),
  name text not null
);

insert into public.users (login, password, role, name) values
  ('admin', 'falysa123', 'admin', 'Admin'),
  ('Izah@micost.edu.my', 'penyelia123', 'supervisor', 'IZAH BINTI MD JEDI')
on conflict (login) do update set
  password = excluded.password,
  role = excluded.role,
  name = excluded.name;

insert into public.students
  (id, password, name, program, company, address, industry_supervisor, university_supervisor, start_date, end_date)
values
  ('DKM03020001', 'Dkm2026', 'Ahmad Farhan', 'Diploma Kejuruteraan Mekanikal', 'Tech Solutions Sdn. Bhd.', 'Cyberjaya, Selangor', 'En. Rizal Hamdan', 'IZAH BINTI MD JEDI', '2025-06-02', '2025-11-14'),
  ('DKM03020305', 'Dkm2026', 'Nur Alisa Shazliyana', 'Diploma Kejuruteraan Mekanikal', 'Maju Industri Sdn. Bhd.', 'Shah Alam, Selangor', 'Pn. Laila Karim', 'IZAH BINTI MD JEDI', '2025-06-02', '2025-11-14'),
  ('DKM03020062', 'Dkm2026', 'Nor Faseha Binti Mohd Halim', 'Diploma Kejuruteraan Mekanikal', 'Inovasi Teknik Sdn. Bhd.', 'Klang, Selangor', 'En. Hafiz Rahman', 'IZAH BINTI MD JEDI', '2025-06-02', '2025-11-14')
on conflict (id) do update set
  name = excluded.name,
  program = excluded.program,
  company = excluded.company,
  address = excluded.address,
  industry_supervisor = excluded.industry_supervisor,
  university_supervisor = excluded.university_supervisor,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  updated_at = now();

insert into public.weekly_logs
  (student_id, week, start_date, end_date, activity, learning, status, approved_by, approved_at)
values
  ('DKM03020001', 1, '2025-01-06', '2025-01-10', 'Orientasi syarikat dan pengenalan tugasan latihan industri', 'Memahami peraturan dan struktur organisasi.', 'approved', '', null),
  ('DKM03020001', 2, '2025-01-13', '2025-01-17', 'Membantu kemaskini dokumen dan fail projek', 'Meningkatkan kemahiran pengurusan dokumen.', 'approved', '', null),
  ('DKM03020001', 3, '2025-01-20', '2025-01-24', 'Membuat semakan keperluan sistem', 'Belajar mengenal pasti masalah pengguna.', 'approved', '', null),
  ('DKM03020001', 4, '2025-01-27', '2025-01-31', 'Menyediakan rekod awal dan dokumentasi teknikal', 'Belajar menyusun dokumentasi projek.', 'approved', '', null),
  ('DKM03020001', 5, '2025-02-03', '2025-02-07', 'Membantu kerja sokongan sistem dalaman', 'Memahami aliran kerja sokongan teknikal.', 'approved', 'IZAH BINTI MD JEDI', '2026-06-25T14:01:25.649Z'),
  ('DKM03020001', 6, '2025-01-27', '2025-01-31', 'Rekabentuk pangkalan data', 'Memahami hubungan data untuk sistem latihan industri.', 'approved', '', null),
  ('DKM03020001', 7, '2025-02-03', '2025-02-07', 'Ujian API integrasi sistem', 'Belajar menguji aliran data dari frontend ke backend.', 'approved', '', null),
  ('DKM03020001', 8, '2025-02-10', '2025-02-14', 'Pembangunan modul laporan PDF', 'Menyusun laporan mingguan untuk semakan.', 'pending', '', null),
  ('DKM03020305', 1, '2025-06-02', '2025-06-06', 'Orientasi syarikat dan pengenalan prosedur kerja.', 'Memahami peraturan keselamatan dan struktur organisasi.', 'approved', '', null),
  ('DKM03020305', 2, '2025-06-09', '2025-06-13', 'Membantu kemas kini rekod inventori dan semakan dokumen teknikal.', 'Meningkatkan ketelitian semasa mengurus dokumen operasi.', 'pending', '', null),
  ('DKM03020062', 1, '2025-06-02', '2025-06-06', 'Pengenalan kepada mesin dan rekod penyelenggaraan.', 'Mengenal pasti dokumen pemeriksaan berkala.', 'approved', '', null)
on conflict (student_id, week) do update set
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  activity = excluded.activity,
  learning = excluded.learning,
  status = excluded.status,
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  updated_at = now();

insert into public.signatures (student_id, supervisor_name, note, signed_at) values
  ('DKM03020001', 'IZAH BINTI MD JEDI', 'Laporan telah disemak dan disahkan.', '2026-06-25T13:54:53.336Z'),
  ('DKM03020305', '', '', null),
  ('DKM03020062', '', '', null)
on conflict (student_id) do update set
  supervisor_name = excluded.supervisor_name,
  note = excluded.note,
  signed_at = excluded.signed_at;

insert into storage.buckets (id, name, public)
values
  ('student-passport', 'student-passport', true),
  ('activity-images', 'activity-images', true)
on conflict (id) do nothing;

alter table public.students enable row level security;
alter table public.weekly_logs enable row level security;
alter table public.signatures enable row level security;
alter table public.users enable row level security;

drop policy if exists "demo read students" on public.students;
drop policy if exists "demo write students" on public.students;
drop policy if exists "demo read weekly logs" on public.weekly_logs;
drop policy if exists "demo write weekly logs" on public.weekly_logs;
drop policy if exists "demo read signatures" on public.signatures;
drop policy if exists "demo write signatures" on public.signatures;
drop policy if exists "demo read users" on public.users;

create policy "demo read students" on public.students for select using (true);
create policy "demo write students" on public.students for all using (true) with check (true);
create policy "demo read weekly logs" on public.weekly_logs for select using (true);
create policy "demo write weekly logs" on public.weekly_logs for all using (true) with check (true);
create policy "demo read signatures" on public.signatures for select using (true);
create policy "demo write signatures" on public.signatures for all using (true) with check (true);
create policy "demo read users" on public.users for select using (true);

drop policy if exists "demo read passport files" on storage.objects;
drop policy if exists "demo write passport files" on storage.objects;
drop policy if exists "demo read activity files" on storage.objects;
drop policy if exists "demo write activity files" on storage.objects;

create policy "demo read passport files" on storage.objects
  for select using (bucket_id = 'student-passport');
create policy "demo write passport files" on storage.objects
  for all using (bucket_id = 'student-passport') with check (bucket_id = 'student-passport');
create policy "demo read activity files" on storage.objects
  for select using (bucket_id = 'activity-images');
create policy "demo write activity files" on storage.objects
  for all using (bucket_id = 'activity-images') with check (bucket_id = 'activity-images');
