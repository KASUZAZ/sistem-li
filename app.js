const API = "";
const SESSION_KEY = "eliSession";
const SUPABASE_URL = "https://ktlxyqpetshzmsxaqmkb.supabase.co";
const SUPABASE_KEY = "sb_publishable_boGVWt8Tzw6_l6mU1ULEbQ_Z3sM1Itl";
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const DEFAULT_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150" viewBox="0 0 120 150">
    <rect width="120" height="150" fill="#eef2f7"/>
    <circle cx="60" cy="48" r="24" fill="#9aa8bd"/>
    <path d="M24 128c7-31 65-31 72 0" fill="#9aa8bd"/>
  </svg>`);

function sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}

async function sbRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: sbHeaders(options.headers || {})
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.message || data?.hint || "Ralat Supabase.";
    throw new Error(message);
  }
  return data;
}

function toLog(row) {
  return {
    week: row.week,
    startDate: row.start_date,
    endDate: row.end_date,
    activity: row.activity,
    learning: row.learning,
    status: row.status,
    activityImage: row.activity_image_url || "",
    approvedBy: row.approved_by || "",
    approvedAt: row.approved_at || ""
  };
}

function toSignature(row) {
  return {
    supervisorName: row?.supervisor_name || "",
    note: row?.note || "",
    signedAt: row?.signed_at || ""
  };
}

function toStudent(row, logs = [], signature = null) {
  return {
    id: row.id,
    name: row.name,
    program: row.program,
    company: row.company,
    address: row.address,
    industrySupervisor: row.industry_supervisor,
    universitySupervisor: row.university_supervisor,
    startDate: row.start_date,
    endDate: row.end_date,
    photo: row.photo_url || "",
    logs: logs.map(toLog).sort((a, b) => Number(a.week) - Number(b.week)),
    signature: toSignature(signature)
  };
}

function toDbStudent(student) {
  return {
    id: student.id,
    password: student.password || "dkm2",
    name: student.name,
    program: student.program || "Diploma Kejuruteraan Mekanikal",
    company: student.company || "-",
    address: student.address || "-",
    industry_supervisor: student.industrySupervisor || "-",
    university_supervisor: student.universitySupervisor || "IZAH BINTI MD JEDI",
    start_date: student.startDate || "2026-06-02",
    end_date: student.endDate || "2026-11-14"
  };
}

async function fetchStudentsFromSupabase(id = "") {
  const filter = id ? `&id=eq.${encodeURIComponent(id)}` : "";
  const [students, logs, signatures] = await Promise.all([
    sbRequest(`/rest/v1/students?select=*&order=name.asc${filter}`),
    sbRequest(`/rest/v1/weekly_logs?select=*&order=week.asc${id ? `&student_id=eq.${encodeURIComponent(id)}` : ""}`),
    sbRequest(`/rest/v1/signatures?select=*${id ? `&student_id=eq.${encodeURIComponent(id)}` : ""}`)
  ]);

  const logsByStudent = new Map();
  logs.forEach(log => {
    if (!logsByStudent.has(log.student_id)) logsByStudent.set(log.student_id, []);
    logsByStudent.get(log.student_id).push(log);
  });

  const signaturesByStudent = new Map(signatures.map(signature => [signature.student_id, signature]));
  return students.map(student => toStudent(
    student,
    logsByStudent.get(student.id) || [],
    signaturesByStudent.get(student.id)
  ));
}

async function fetchStudentFromSupabase(id) {
  const students = await fetchStudentsFromSupabase(id);
  if (!students.length) throw new Error("Pelajar tidak ditemui.");
  return students[0];
}

function getMonthlyReport(logs) {
  const months = new Map();

  logs.forEach(log => {
    const key = (log.startDate || "").slice(0, 7) || "Tanpa bulan";
    if (!months.has(key)) {
      months.set(key, {
        month: key,
        startDate: log.startDate,
        endDate: log.endDate,
        weeks: [],
        activity: [],
        learning: [],
        approved: 0,
        pending: 0
      });
    }

    const month = months.get(key);
    month.weeks.push(log.week);
    month.endDate = log.endDate || month.endDate;
    month.activity.push(`Minggu ${log.week}: ${log.activity}`);
    if (log.learning) month.learning.push(`Minggu ${log.week}: ${log.learning}`);
    if (log.status === "approved") month.approved += 1;
    if (log.status !== "approved") month.pending += 1;
  });

  return Array.from(months.values()).map(month => ({
    ...month,
    activity: month.activity.join("\n"),
    learning: month.learning.join("\n")
  }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  return fallback;
}

function studentFromCsvRow(row) {
  const id = pick(row, ["id", "matrik", "no_matrik", "no_matrik_id", "nomatrik"]);
  if (!id) return null;
  return {
    id,
    password: pick(row, ["password", "kata_laluan", "katalaluan"], "dkm2"),
    name: pick(row, ["name", "nama", "nama_pelajar"], id),
    program: pick(row, ["program", "kursus"], "Diploma Kejuruteraan Mekanikal"),
    company: pick(row, ["company", "syarikat", "nama_syarikat"], "-"),
    address: pick(row, ["address", "alamat", "alamat_syarikat"], "-"),
    industrySupervisor: pick(row, ["industrysupervisor", "penyelia_industri", "penyeliaindustri"], "-"),
    universitySupervisor: pick(row, ["universitysupervisor", "penyelia_universiti", "penyeliauniversiti"], "IZAH BINTI MD JEDI"),
    startDate: pick(row, ["startdate", "tarikh_mula", "tarikhmula"], "2026-06-02"),
    endDate: pick(row, ["enddate", "tarikh_akhir", "tarikhakhir"], "2026-11-14")
  };
}

async function uploadDataUrl(bucket, prefix, dataUrl) {
  if (!dataUrl) return "";
  const fileResponse = await fetch(dataUrl);
  const blob = await fileResponse.blob();
  const extension = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const filePath = `${encodeURIComponent(prefix)}/${Date.now()}.${extension}`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": blob.type || "application/octet-stream",
      "x-upsert": "true"
    }),
    body: blob
  });
  const data = await upload.json().catch(() => null);
  if (!upload.ok) throw new Error(data?.message || "Gagal upload fail.");
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}`;
}

async function supabaseApi(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const url = new URL(path, location.origin);
  const parts = url.pathname.split("/").filter(Boolean);
  const body = options.body ? JSON.parse(options.body) : {};

  if (method === "POST" && url.pathname === "/api/login") {
    if (body.role === "admin" || body.role === "supervisor") {
      const users = await sbRequest(
        `/rest/v1/users?select=*&login=eq.${encodeURIComponent(body.id)}&password=eq.${encodeURIComponent(body.password)}&role=eq.${encodeURIComponent(body.role)}&limit=1`
      );
      if (!users.length) throw new Error("Login pentadbir tidak sah.");
      return { role: users[0].role, id: users[0].login, redirect: "admin.html" };
    }

    const students = await sbRequest(
      `/rest/v1/students?select=id&id=eq.${encodeURIComponent(body.id)}&password=eq.${encodeURIComponent(body.password)}&limit=1`
    );
    if (!students.length) throw new Error("Login pelajar tidak sah.");
    return { role: "student", id: students[0].id, redirect: "dashboard.html" };
  }

  if (method === "POST" && url.pathname === "/api/register") {
    const required = ["id", "password", "name", "program", "company", "address", "industrySupervisor", "startDate", "endDate"];
    if (required.some(key => !String(body[key] || "").trim())) throw new Error("Sila lengkapkan semua maklumat wajib.");
    if (String(body.password).length < 6) throw new Error("Kata laluan mesti sekurang-kurangnya 6 aksara.");
    if (body.password !== body.confirmPassword) throw new Error("Sahkan kata laluan dengan betul.");
    if (body.endDate < body.startDate) throw new Error("Tarikh tamat mesti selepas tarikh mula.");
    const existing = await sbRequest(`/rest/v1/students?select=id&id=eq.${encodeURIComponent(body.id)}&limit=1`);
    if (existing.length) throw new Error("No. matrik ini sudah berdaftar.");
    await sbRequest("/rest/v1/students", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ id: body.id.toUpperCase(), password: body.password, name: body.name, program: body.program, company: body.company, address: body.address, industry_supervisor: body.industrySupervisor, university_supervisor: "IZAH BINTI MD JEDI", start_date: body.startDate, end_date: body.endDate }) });
    await sbRequest("/rest/v1/signatures", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ student_id: body.id.toUpperCase(), supervisor_name: "", note: "", signed_at: null }) });
    return { role: "student", id: body.id.toUpperCase(), redirect: "dashboard.html" };
  }

  if (method === "GET" && url.pathname === "/api/students") {
    return fetchStudentsFromSupabase();
  }

  if (method === "POST" && url.pathname === "/api/students/import") {
    const rows = parseCsv(body.csv || "");
    if (rows.length < 2) throw new Error("CSV mesti ada header dan sekurang-kurangnya satu pelajar.");

    const headers = rows[0].map(normalizeHeader);
    const students = rows.slice(1).map(values => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || "";
      });
      return studentFromCsvRow(row);
    }).filter(Boolean);

    const current = await fetchStudentsFromSupabase();
    const currentIds = new Set(current.map(student => student.id));
    const imported = students.filter(student => !currentIds.has(student.id)).length;
    const updated = students.length - imported;

    if (students.length) {
      await sbRequest("/rest/v1/students?on_conflict=id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(students.map(toDbStudent))
      });
      await sbRequest("/rest/v1/signatures?on_conflict=student_id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates"
        },
        body: JSON.stringify(students.map(student => ({
          student_id: student.id,
          supervisor_name: "",
          note: "",
          signed_at: null
        })))
      });
    }

    return { imported, updated, total: current.length + imported, students: await fetchStudentsFromSupabase() };
  }

  if (parts[0] === "api" && parts[1] === "students" && parts[2]) {
    const id = decodeURIComponent(parts[2]);

    if (method === "GET" && parts.length === 3) {
      return fetchStudentFromSupabase(id);
    }

    if (method === "GET" && parts[3] === "reports") {
      const period = url.searchParams.get("period") === "monthly" ? "monthly" : "weekly";
      const student = await fetchStudentFromSupabase(id);
      return {
        student,
        period,
        items: period === "monthly" ? getMonthlyReport(student.logs) : student.logs
      };
    }

    if (method === "POST" && parts[3] === "profile-photo") {
      const photoUrl = await uploadDataUrl("student-passport", id, body.photo || "");
      await sbRequest(`/rest/v1/students?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ photo_url: photoUrl })
      });
      return fetchStudentFromSupabase(id);
    }

    if (method === "POST" && parts[3] === "logs" && parts.length === 4) {
      const week = Number(body.week);
      if (!week || !body.startDate || !body.endDate || !body.activity) {
        throw new Error("Minggu, tarikh dan aktiviti wajib diisi.");
      }

      const activityImageUrl = await uploadDataUrl("activity-images", `${id}-minggu-${week}`, body.activityImage || "");
      await sbRequest("/rest/v1/weekly_logs?on_conflict=student_id,week", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify({
          student_id: id,
          week,
          start_date: body.startDate,
          end_date: body.endDate,
          activity: body.activity,
          learning: body.learning || "",
          status: "pending",
          activity_image_url: activityImageUrl
        })
      });
      return fetchStudentFromSupabase(id);
    }

    if (method === "POST" && parts[3] === "logs" && parts[4] && parts[5] === "status") {
      const week = Number(parts[4]);
      await sbRequest(`/rest/v1/weekly_logs?student_id=eq.${encodeURIComponent(id)}&week=eq.${week}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({
          status: body.status === "rejected" ? "pending" : "approved",
          approved_by: body.approvedBy || "IZAH BINTI MD JEDI",
          approved_at: new Date().toISOString()
        })
      });
      return fetchStudentFromSupabase(id);
    }

    if (method === "POST" && parts[3] === "signature") {
      await sbRequest("/rest/v1/signatures?on_conflict=student_id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify({
          student_id: id,
          supervisor_name: body.supervisorName || "",
          note: body.note || "",
          signed_at: new Date().toISOString()
        })
      });
      return fetchStudentFromSupabase(id);
    }
  }

  throw new Error("API Supabase tidak ditemui.");
}

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

function session() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(value) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  location.href = "index.html";
}

async function api(path, options = {}) {
  if (USE_SUPABASE) {
    return supabaseApi(path, options);
  }

  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Ralat sistem.");
  return data;
}

function requireRole(role) {
  const current = session();
  const roles = Array.isArray(role) ? role : [role];
  if (!current || !roles.includes(current.role)) {
    location.href = "index.html";
    return null;
  }
  return current;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Gagal membaca fail."));
    reader.readAsDataURL(file);
  });
}

function isImageAttachment(url = "") {
  if (!url) return false;
  if (url.startsWith("data:image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url);
}

function attachmentName(url = "") {
  if (!url) return "Lampiran report";
  try {
    const pathname = new URL(url, location.origin).pathname;
    const name = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
    return name || "Lampiran report";
  } catch {
    return "Lampiran report";
  }
}

function attachmentHtml(url, week) {
  if (!url) return "";
  if (isImageAttachment(url)) {
    return `<img class="activity-photo" src="${url}" alt="Lampiran gambar minggu ${week}">`;
  }
  return `
    <div class="report-attachment">
      <span class="attachment-icon">FILE</span>
      <div>
        <strong>Lampiran Report</strong>
        <span>${attachmentName(url)}</span>
      </div>
      <a class="btn-small" href="${url}" target="_blank" rel="noopener">Buka fail</a>
    </div>
  `;
}

function fmtDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ms-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function fmtShortRange(startValue, endValue) {
  if (!startValue || !endValue) return "-";
  const start = new Date(startValue);
  const end = new Date(endValue);
  const startDay = new Intl.DateTimeFormat("ms-MY", { day: "numeric" }).format(start);
  const endDay = new Intl.DateTimeFormat("ms-MY", { day: "numeric" }).format(end);
  const month = new Intl.DateTimeFormat("ms-MY", { month: "short" }).format(end);
  return `${startDay}–${endDay} ${month}`;
}

function fmtTrainingRange(student) {
  if (!student.startDate || !student.endDate) return "-";
  const start = new Intl.DateTimeFormat("ms-MY", { month: "short" }).format(new Date(student.startDate));
  const end = new Intl.DateTimeFormat("ms-MY", { month: "short", year: "numeric" }).format(new Date(student.endDate));
  return `${start} – ${end}`;
}

function fmtMonth(value) {
  if (!value || value === "Tanpa bulan") return value || "-";
  return new Intl.DateTimeFormat("ms-MY", {
    month: "long",
    year: "numeric"
  }).format(new Date(`${value}-01`));
}

function statusLabel(status) {
  if (status === "approved") return "Disahkan";
  if (status === "rejected") return "Ditolak";
  return "Menunggu";
}

function statusClass(status) {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return "pending";
}

function signatureBadge(signature) {
  if (signature?.signedAt) {
    return '<span class="sign-badge signed">✓ Sudah sign</span>';
  }
  return '<span class="sign-badge unsigned">Belum sign</span>';
}

function trainingWeeks(student) {
  const start = new Date(student.startDate);
  const end = new Date(student.endDate);
  const total = Math.max(1, Math.ceil((end - start) / (7 * 24 * 60 * 60 * 1000)));
  const latest = student.logs.reduce((max, log) => Math.max(max, Number(log.week) || 0), 0);
  return `${latest} / ${total}`;
}

function initLogout() {
  qsa("[data-logout]").forEach(button => button.addEventListener("click", logout));
}

function initLogin() {
  const form = qs("#loginForm");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const error = qs("#errorMsg");
    error.hidden = true;

    try {
      const payload = {
        id: qs("#matrik").value.trim(),
        password: qs("#password").value.trim(),
        role: qs("#role").value
      };
      const result = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      saveSession({ role: result.role, id: result.id || "admin" });
      location.href = result.redirect;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
}

async function initStudentDashboard() {
  const current = requireRole("student");
  if (!current) return;

  const student = await api(`/api/students/${encodeURIComponent(current.id)}`);
  qs("#welcomeName").textContent = `Selamat Datang, ${student.name} 👋`;
  qs("#trainingRange").textContent = fmtTrainingRange(student);
  if (qs("#studentPhoto")) qs("#studentPhoto").src = student.photo || DEFAULT_PHOTO;
  if (qs("#studentName")) qs("#studentName").textContent = student.name;
  if (qs("#studentId")) qs("#studentId").textContent = student.id;
  qs("#weekProgress").textContent = trainingWeeks(student);
  qs("#logCount").textContent = student.logs.length;
  qs("#approvedCount").textContent = student.logs.filter(log => log.status === "approved").length;
  if (qs("#supervisorStatus")) {
    qs("#supervisorStatus").textContent = student.signature?.signedAt ? "Sudah ditandatangan" : "Belum sign";
  }
  if (qs("#companyName")) qs("#companyName").textContent = student.company;
  if (qs("#companyAddress")) qs("#companyAddress").textContent = student.address;
  if (qs("#industrySupervisor")) qs("#industrySupervisor").textContent = student.industrySupervisor;
  if (qs("#universitySupervisor")) qs("#universitySupervisor").textContent = student.universitySupervisor;
  if (qs("#companyPanelName")) qs("#companyPanelName").textContent = student.company;
  if (qs("#companyPanelAddress")) qs("#companyPanelAddress").textContent = student.address;
  if (qs("#companyPanelSupervisor")) qs("#companyPanelSupervisor").textContent = student.industrySupervisor;
  if (qs("#companyPanelPeriod")) qs("#companyPanelPeriod").textContent = fmtTrainingRange(student);
  if (qs("#supervisorPanelUniversity")) qs("#supervisorPanelUniversity").textContent = student.universitySupervisor;
  if (qs("#supervisorPanelIndustry")) qs("#supervisorPanelIndustry").textContent = student.industrySupervisor;
  if (qs("#supervisorPanelCompany")) qs("#supervisorPanelCompany").textContent = student.company;
  if (qs("#supervisorPanelSign")) qs("#supervisorPanelSign").innerHTML = signatureBadge(student.signature);
  if (qs("#supervisorPanelApproved")) {
    qs("#supervisorPanelApproved").textContent = `${student.logs.filter(log => log.status === "approved").length} log`;
  }

  qs("#studentLogs").innerHTML = [...student.logs]
    .sort((a, b) => b.week - a.week)
    .slice(0, 3)
    .map(log => `
      <tr>
        <td>Minggu ${log.week}</td>
        <td>${fmtShortRange(log.startDate, log.endDate)}</td>
        <td>${log.activity}</td>
        <td><span class="status ${statusClass(log.status)}">${statusLabel(log.status)}</span></td>
      </tr>
    `)
    .join("");

  if (qs("#photoInput")) {
    qs("#photoInput").addEventListener("change", async event => {
      const photo = await fileToDataUrl(event.target.files[0]);
      const updated = await api(`/api/students/${encodeURIComponent(current.id)}/profile-photo`, {
        method: "POST",
        body: JSON.stringify({ photo })
      });
      qs("#studentPhoto").src = updated.photo || DEFAULT_PHOTO;
    });
  }

  setupStudentPanels();
}

function setupStudentPanels() {
  qsa("[data-student-panel]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      const panelType = link.dataset.studentPanel;
      const target = panelType === "company" ? qs("#syarikat-panel") : qs("#penyelia-panel");
      qsa(".student-detail-panel").forEach(panel => {
        panel.hidden = panel !== target;
      });
      qsa(".student-layout .sidebar nav a").forEach(item => item.classList.remove("active"));
      link.classList.add("active");
      target.hidden = false;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

async function initAdmin() {
  const current = requireRole(["admin", "supervisor"]);
  if (!current) return;
  const students = await api("/api/students");
  const tbody = qs("#studentList");
  const search = qs("#studentSearch");
  const isAdmin = current.role === "admin";

  renderAdminHeader(isAdmin);
  renderAdminStats(students, isAdmin);
  renderAdminTools(isAdmin, students);

  function render(filter = "") {
    const term = filter.toLowerCase();
    tbody.innerHTML = students
      .filter(student => `${student.name} ${student.id}`.toLowerCase().includes(term))
      .map(student => `
        <tr>
          <td>
            <button class="student-link" data-id="${student.id}">
              ${student.name}
            </button>
          </td>
          <td>${student.id}</td>
          <td>${fmtDate(student.startDate)} - ${fmtDate(student.endDate)}</td>
          <td>${student.logs.length} minggu</td>
          <td>${signatureBadge(student.signature)}</td>
        </tr>
      `)
      .join("");

    qsa(".student-link", tbody).forEach(button => {
      button.addEventListener("click", () => {
        location.href = `report.html?student=${encodeURIComponent(button.dataset.id)}&period=weekly`;
      });
    });
  }

  search.addEventListener("input", () => render(search.value));
  render();
}

function renderAdminHeader(isAdmin) {
  if (qs("#adminRoleLabel")) qs("#adminRoleLabel").textContent = isAdmin ? "Admin" : "Penyelia";
  if (qs("#adminEyebrow")) qs("#adminEyebrow").textContent = isAdmin ? "Pentadbiran" : "Penyelia Universiti";
  if (qs("#adminTitle")) qs("#adminTitle").textContent = isAdmin ? "Dashboard Admin" : "Dashboard Penyelia";
  if (qs("#adminModeBadge")) qs("#adminModeBadge").textContent = isAdmin ? "Tools penuh" : "Semakan report";

  qsa(".admin-only-link").forEach(link => {
    link.style.display = isAdmin ? "" : "none";
  });
}

function renderAdminStats(students, isAdmin) {
  const totalLogs = students.reduce((sum, student) => sum + student.logs.length, 0);
  const approvedLogs = students.reduce((sum, student) => (
    sum + student.logs.filter(log => log.status === "approved").length
  ), 0);
  const pendingLogs = totalLogs - approvedLogs;
  const signedReports = students.filter(student => student.signature?.signedAt).length;

  const stats = isAdmin
    ? [
        ["👨‍🎓", "Jumlah Pelajar", students.length],
        ["📋", "Jumlah Log", totalLogs],
        ["✅", "Log Disahkan", approvedLogs],
        ["⏳", "Menunggu Semakan", pendingLogs],
        ["✍️", "Report Ditandatangan", signedReports],
        ["🏢", "Syarikat Aktif", new Set(students.map(student => student.company)).size]
      ]
    : [
        ["👨‍🎓", "Pelajar Dipantau", students.length],
        ["📋", "Report Mingguan", totalLogs],
        ["⏳", "Perlu Disahkan", pendingLogs]
      ];

  if (!qs("#adminStats")) return;
  qs("#adminStats").innerHTML = stats.map(([icon, label, value]) => `
    <div class="card admin-stat-card">
      <span class="card-icon">${icon}</span>
      <span class="card-label">${label}</span>
      <span class="card-value">${value}</span>
    </div>
  `).join("");
}

function renderAdminTools(isAdmin, students) {
  const adminTools = [
    ["👨‍🎓", "Urus Pelajar", "Tambah, kemas kini dan semak maklumat pelajar."],
    ["🏢", "Urus Syarikat", "Maklumat penempatan dan organisasi latihan."],
    ["👩‍🏫", "Urus Penyelia", "Tetapan penyelia universiti dan industri."],
    ["📋", "Semak Semua Report", "Pantau laporan mingguan semua pelajar."],
    ["✅", "Pengesahan Pukal", "Semak status log yang belum disahkan."],
    ["📊", "Analitik LI", "Ringkasan prestasi latihan industri."],
    ["⚙️", "Tetapan Sistem", "Konfigurasi akaun, tempoh LI dan akses."]
  ];

  const supervisorTools = [
    ["📋", "Semak Report", "Lihat report mingguan pelajar."],
    ["✅", "Sahkan Log", "Tekan nama pelajar dan sahkan log yang menunggu."],
    ["✍️", "Sign Report", "Tandatangan pengesahan penyelia."],
    ["🔎", "Cari Pelajar", "Cari pelajar mengikut nama atau matrik."]
  ];

  const tools = isAdmin ? adminTools : supervisorTools;
  if (qs("#toolsTitle")) qs("#toolsTitle").textContent = isAdmin ? "Tools Admin" : "Tools Penyelia";
  if (!qs("#adminTools")) return;

  qs("#adminTools").innerHTML = tools.map(([icon, title, desc]) => `
    <button class="tool-card" type="button" data-tool="${toolIdFromTitle(title)}">
      <span class="tool-icon">${icon}</span>
      <span class="tool-title">${title}</span>
      <span class="tool-desc">${desc}</span>
    </button>
  `).join("");

  qsa(".tool-card", qs("#adminTools")).forEach(button => {
    button.addEventListener("click", () => {
      qsa(".tool-card", qs("#adminTools")).forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      renderToolDetail(button.dataset.tool, students, isAdmin);
      qs("#toolDetail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function toolIdFromTitle(title) {
  const map = {
    "Urus Pelajar": "students",
    "Urus Syarikat": "companies",
    "Urus Penyelia": "supervisors",
    "Semak Semua Report": "reports",
    "Pengesahan Pukal": "bulk-approval",
    "Analitik LI": "analytics",
    "Tetapan Sistem": "settings",
    "Semak Report": "reports",
    "Sahkan Log": "bulk-approval",
    "Sign Report": "sign",
    "Cari Pelajar": "search"
  };
  return map[title] || "reports";
}

function renderToolDetail(tool, students, isAdmin) {
  const detail = qs("#toolDetail");
  if (!detail) return;

  detail.hidden = false;
  const totalLogs = students.reduce((sum, student) => sum + student.logs.length, 0);
  const pendingRows = students.flatMap(student => (
    student.logs
      .filter(log => log.status !== "approved")
      .map(log => ({ student, log }))
  ));
  const emptyRow = '<tr><td colspan="5">Tiada rekod.</td></tr>';

  const views = {
    students: () => `
      <div class="box-header"><h2>Urus Pelajar</h2><span class="badge-info">${students.length} pelajar</span></div>
      <div class="tool-actions">
        <button class="btn primary" type="button">+ Tambah Pelajar</button>
        <button class="btn secondary" type="button" id="importCsvBtn">Import CSV</button>
        <input id="importCsvInput" type="file" accept=".csv,text/csv" hidden>
        <span class="tool-note inline" id="importCsvMsg"></span>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Nama</th><th>No. Matrik</th><th>Syarikat</th><th>Log</th><th>Status</th></tr></thead><tbody>
        ${students.map(student => `<tr><td>${student.name}</td><td>${student.id}</td><td>${student.company}</td><td>${student.logs.length}</td><td>${signatureBadge(student.signature)}</td></tr>`).join("")}
      </tbody></table></div>
    `,
    companies: () => {
      const companies = Array.from(new Map(students.map(student => [student.company, student])).values());
      return `
        <div class="box-header"><h2>Urus Syarikat</h2><span class="badge-info">${companies.length} syarikat</span></div>
        <div class="table-wrap"><table><thead><tr><th>Syarikat</th><th>Alamat</th><th>Pelajar</th><th>Penyelia Industri</th></tr></thead><tbody>
          ${companies.map(company => `<tr><td>${company.company}</td><td>${company.address}</td><td>${students.filter(student => student.company === company.company).length}</td><td>${company.industrySupervisor}</td></tr>`).join("")}
        </tbody></table></div>
      `;
    },
    supervisors: () => `
      <div class="box-header"><h2>Urus Penyelia</h2><span class="badge-info">Universiti & industri</span></div>
      <div class="tool-summary-grid">
        <div class="mini-panel"><strong>Penyelia Universiti</strong><span>IZAH BINTI MD JEDI</span><span>Izah@micost.edu.my</span></div>
        ${students.map(student => `<div class="mini-panel"><strong>${student.industrySupervisor}</strong><span>${student.company}</span><span>${student.name}</span></div>`).join("")}
      </div>
    `,
    reports: () => `
      <div class="box-header"><h2>${isAdmin ? "Semak Semua Report" : "Semak Report"}</h2><span class="badge-info">${totalLogs} log</span></div>
      <div class="table-wrap"><table><thead><tr><th>Pelajar</th><th>Minggu</th><th>Aktiviti</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>
        ${students.flatMap(student => student.logs.map(log => `<tr><td>${student.name}</td><td>Minggu ${log.week}</td><td>${log.activity}</td><td><span class="status ${statusClass(log.status)}">${statusLabel(log.status)}</span></td><td><a class="btn-small" href="report.html?student=${encodeURIComponent(student.id)}&period=weekly">Buka</a></td></tr>`)).join("")}
      </tbody></table></div>
    `,
    "bulk-approval": () => `
      <div class="box-header"><h2>${isAdmin ? "Pengesahan Pukal" : "Sahkan Log"}</h2><span class="badge-info">${pendingRows.length} menunggu</span></div>
      <div class="table-wrap"><table><thead><tr><th>Pelajar</th><th>Minggu</th><th>Aktiviti</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>
        ${pendingRows.map(({ student, log }) => `<tr><td>${student.name}</td><td>Minggu ${log.week}</td><td>${log.activity}</td><td><span class="status ${statusClass(log.status)}">${statusLabel(log.status)}</span></td><td><a class="btn-small" href="report.html?student=${encodeURIComponent(student.id)}&period=weekly">Sahkan</a></td></tr>`).join("") || emptyRow}
      </tbody></table></div>
    `,
    analytics: () => {
      const approved = students.reduce((sum, student) => sum + student.logs.filter(log => log.status === "approved").length, 0);
      const pending = totalLogs - approved;
      return `
        <div class="box-header"><h2>Analitik LI</h2><span class="badge-info">Ringkasan</span></div>
        <div class="tool-summary-grid">
          <div class="mini-panel"><strong>${students.length}</strong><span>Jumlah pelajar</span></div>
          <div class="mini-panel"><strong>${totalLogs}</strong><span>Jumlah log</span></div>
          <div class="mini-panel"><strong>${approved}</strong><span>Log disahkan</span></div>
          <div class="mini-panel"><strong>${pending}</strong><span>Menunggu semakan</span></div>
        </div>
      `;
    },
    settings: () => `
      <div class="box-header"><h2>Tetapan Sistem</h2><span class="badge-info">Konfigurasi</span></div>
      <div class="tool-summary-grid">
        <div class="mini-panel"><strong>Tempoh LI</strong><span>Jun - Nov 2026</span></div>
        <div class="mini-panel"><strong>Akaun Admin</strong><span>admin</span></div>
        <div class="mini-panel"><strong>Akaun Penyelia</strong><span>Izah@micost.edu.my</span></div>
        <div class="mini-panel"><strong>Mode Report</strong><span>Mingguan / Bulanan</span></div>
      </div>
    `,
    sign: () => `
      <div class="box-header"><h2>Sign Report</h2><span class="badge-info">IZAH BINTI MD JEDI</span></div>
      <div class="table-wrap"><table><thead><tr><th>Pelajar</th><th>No. Matrik</th><th>Status Sign</th><th>Tindakan</th></tr></thead><tbody>
        ${students.map(student => `<tr><td>${student.name}</td><td>${student.id}</td><td>${signatureBadge(student.signature)}</td><td><a class="btn-small" href="report.html?student=${encodeURIComponent(student.id)}&period=weekly">Buka</a></td></tr>`).join("")}
      </tbody></table></div>
    `,
    search: () => `
      <div class="box-header"><h2>Cari Pelajar</h2><span class="badge-info">Nama / matrik</span></div>
      <p class="tool-note">Gunakan kotak carian pada jadual Senarai Pelajar untuk tapis nama atau nombor matrik.</p>
    `
  };

  detail.innerHTML = (views[tool] || views.reports)();
  setupCsvImport(isAdmin);
}

function setupCsvImport(isAdmin) {
  const button = qs("#importCsvBtn");
  const input = qs("#importCsvInput");
  const message = qs("#importCsvMsg");
  if (!button || !input || !isAdmin) return;

  button.addEventListener("click", () => input.click());
  input.addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;

    message.textContent = "Sedang import...";
    try {
      const csv = await file.text();
      const result = await api("/api/students/import", {
        method: "POST",
        body: JSON.stringify({ csv })
      });
      message.textContent = `Berjaya import ${result.imported}, kemas kini ${result.updated}.`;
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      message.textContent = err.message;
    } finally {
      input.value = "";
    }
  });
}

async function initLogForm() {
  const current = requireRole("student");
  if (!current) return;

  const form = qs("#logForm");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const msg = qs("#formMsg");
    msg.hidden = true;

    const fileInput = qs("#activityFile") || qs("#activityImage");
    const activityImage = fileInput ? await fileToDataUrl(fileInput.files[0]) : "";
    await api(`/api/students/${encodeURIComponent(current.id)}/logs`, {
      method: "POST",
      body: JSON.stringify({
        week: qs("#week").value,
        startDate: qs("#startDate").value,
        endDate: qs("#endDate").value,
        activity: qs("#activity").value.trim(),
        learning: qs("#learning").value.trim(),
        activityImage
      })
    });

    msg.hidden = false;
    form.reset();
  });
}

function reportItemHtml(item, period, canApprove = false) {
  if (period === "monthly") {
    return `
      <article class="report-card">
        <div>
          <h3>${fmtMonth(item.month)}</h3>
          <p><strong>Minggu:</strong> ${item.weeks.join(", ")}</p>
          <p><strong>Tempoh:</strong> ${fmtDate(item.startDate)} - ${fmtDate(item.endDate)}</p>
          <p><strong>Gabungan aktiviti:</strong><br>${item.activity.replace(/\n/g, "<br>")}</p>
          <p><strong>Pembelajaran:</strong><br>${item.learning.replace(/\n/g, "<br>") || "-"}</p>
          <p><strong>Status:</strong> ${item.approved} disahkan, ${item.pending} menunggu</p>
        </div>
      </article>
    `;
  }

  return `
    <article class="report-card">
      <div>
        <h3>Minggu ${item.week}</h3>
        <p><strong>Tarikh:</strong> ${fmtDate(item.startDate)} - ${fmtDate(item.endDate)}</p>
        <p><strong>Aktiviti:</strong> ${item.activity}</p>
        <p><strong>Pembelajaran:</strong> ${item.learning || "-"}</p>
        <div class="report-status-row">
          <p><strong>Status:</strong> <span class="status ${statusClass(item.status)}">${statusLabel(item.status)}</span></p>
          ${canApprove && item.status !== "approved" ? `<button class="btn approve-btn" type="button" data-week="${item.week}">Sahkan</button>` : ""}
        </div>
      </div>
      ${attachmentHtml(item.activityImage, item.week)}
    </article>
  `;
}

async function renderReport(studentId, period, isAdmin) {
  const report = await api(`/api/students/${encodeURIComponent(studentId)}/reports?period=${period}`);
  const student = report.student;
  const mount = qs("#reportMount");

  mount.innerHTML = `
    <header class="topbar report-header">
      <img class="avatar" src="${student.photo || DEFAULT_PHOTO}" alt="Gambar passport pelajar">
      <div>
        <p class="eyebrow">${isAdmin ? "Report Pelajar" : "Laporan Saya"}</p>
        <h1>${student.name}</h1>
        <p>${student.id} | ${student.company}</p>
      </div>
      <div class="period-tabs">
        <button data-period="weekly" class="${period === "weekly" ? "active" : ""}">Mingguan</button>
        <button data-period="monthly" class="${period === "monthly" ? "active" : ""}">Bulanan</button>
      </div>
    </header>

    <section class="box">
      <h2>Maklumat Latihan Industri</h2>
      <div class="table-wrap">
        <table>
          <tbody>
            <tr><th>Syarikat</th><td>${student.company}</td></tr>
            <tr><th>Alamat</th><td>${student.address}</td></tr>
            <tr><th>Penyelia Industri</th><td>${student.industrySupervisor}</td></tr>
            <tr><th>Penyelia Institusi</th><td>${student.universitySupervisor}</td></tr>
            <tr><th>Tempoh</th><td>${fmtDate(student.startDate)} - ${fmtDate(student.endDate)}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="box">
      <div class="box-header">
        <h2>${period === "monthly" ? "Report Bulanan" : "Report Mingguan"}</h2>
        <span class="badge-info">${report.items.length} rekod</span>
      </div>
      <div class="report-grid">
        ${report.items.length ? report.items.map(item => reportItemHtml(item, period, isAdmin)).join("") : "<p>Tiada report lagi.</p>"}
      </div>
    </section>

    <section class="box">
      <h2>Pengesahan Penyelia</h2>
      <div class="signature-panel">
        <p><strong>Status:</strong> ${signatureBadge(student.signature)}</p>
        ${student.signature?.signedAt ? `<p><strong>Ditandatangan oleh:</strong> ${student.signature.supervisorName} pada ${fmtDate(student.signature.signedAt)}</p>` : ""}
        <p><strong>Catatan:</strong> ${student.signature?.note || "-"}</p>
        ${isAdmin ? `
          <form id="signatureForm" class="form-grid">
            <div class="field">
              <label for="supervisorName">Nama Penyelia</label>
              <input id="supervisorName" value="IZAH BINTI MD JEDI" required>
            </div>
            <div class="field full">
              <label for="signatureNote">Catatan Pengesahan</label>
              <textarea id="signatureNote" rows="2" placeholder="Contoh: Laporan minggu ini telah disemak."></textarea>
            </div>
            <div class="field full form-actions">
              <button class="btn primary" type="submit">Sign / Sahkan Report</button>
            </div>
          </form>
        ` : ""}
      </div>
    </section>
  `;

  qsa("[data-period]", mount).forEach(button => {
    button.addEventListener("click", () => {
      const nextPeriod = button.dataset.period;
      if (isAdmin) {
        history.replaceState(null, "", `report.html?student=${encodeURIComponent(studentId)}&period=${nextPeriod}`);
      }
      renderReport(studentId, nextPeriod, isAdmin);
    });
  });

  const signatureForm = qs("#signatureForm", mount);
  if (signatureForm) {
    signatureForm.addEventListener("submit", async event => {
      event.preventDefault();
      await api(`/api/students/${encodeURIComponent(studentId)}/signature`, {
        method: "POST",
        body: JSON.stringify({
          supervisorName: qs("#supervisorName").value.trim(),
          note: qs("#signatureNote").value.trim()
        })
      });
      renderReport(studentId, period, isAdmin);
    });
  }

  qsa(".approve-btn", mount).forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Menyimpan...";
      await api(`/api/students/${encodeURIComponent(studentId)}/logs/${button.dataset.week}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: "approved",
          approvedBy: "IZAH BINTI MD JEDI"
        })
      });
      renderReport(studentId, period, isAdmin);
    });
  });
}

async function initAdminReport() {
  const current = requireRole(["admin", "supervisor"]);
  if (!current) return;
  const params = new URLSearchParams(location.search);
  const studentId = params.get("student");
  const period = params.get("period") === "monthly" ? "monthly" : "weekly";
  if (!studentId) {
    location.href = "admin.html";
    return;
  }
  await renderReport(studentId, period, true);
}

async function initMyReport() {
  const current = requireRole("student");
  if (!current) return;
  await renderReport(current.id, "weekly", false);
}

function dailyKey(id) { return `eliDailyLogs:${id}`; }
function readDaily(id) { try { return JSON.parse(localStorage.getItem(dailyKey(id)) || "[]"); } catch { return []; } }
function writeDaily(id, logs) { localStorage.setItem(dailyKey(id), JSON.stringify(logs)); }
function isoDate(date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function dateRange(start, end) { const out = []; const cursor = new Date(`${start}T00:00:00`); const last = new Date(`${end}T00:00:00`); while (cursor <= last) { out.push(isoDate(cursor)); cursor.setDate(cursor.getDate() + 1); } return out; }
function prettyDate(value, options = { day: "numeric", month: "short", year: "numeric" }) { return new Intl.DateTimeFormat("ms-MY", options).format(new Date(`${value}T00:00:00`)); }
function monthName(key) { return new Intl.DateTimeFormat("ms-MY", { month: "long", year: "numeric" }).format(new Date(`${key}-01T00:00:00`)); }
function studentPeriod(student) { return dateRange(student.startDate, student.endDate); }
function mergeEntries(student) { return readDaily(student.id); }
function sideIdentity(student) { qsa("#sideName").forEach(el => el.textContent = student.name); qsa("#sideId").forEach(el => el.textContent = student.id); qsa("#sidePhoto").forEach(el => el.src = student.photo || DEFAULT_PHOTO); }
function progressFor(student) { const days = studentPeriod(student); const entries = mergeEntries(student); const logged = new Set(entries.map(item => item.date)); return { total: days.length, logged: days.filter(day => logged.has(day)).length, entries, days }; }
function monthKeys(student) { return [...new Set(studentPeriod(student).map(day => day.slice(0, 7)))]; }

function initRegister() {
  const form = qs("#registerForm"); if (!form) return;
  const programInput = qs("#registerProgram");
  if (programInput) {
    const groups = {
      "Fakulti Teknologi Maklumat & Multimedia": [
        "Diploma in Computer Science", "Diploma in Open Source Computing", "Diploma in Digital Animation", "Diploma in Interactive Media", "Diploma in Graphic Design", "Diploma in Game Design", "Bachelor of Information & Communication Technology (Hons)", "Bachelor of Digital Creative Media (Hons)"
      ],
      "MiCoSTSkills (Program TVET & Kemahiran)": [
        "SKM - Operasi Sistem Komputer", "DKM - Pentadbiran Sistem Komputer"
      ],
      "Fakulti Pengurusan Perniagaan": [
        "Pra Diploma Perdagangan (Usahasama UiTM)", "Diploma In Business Studies (Usahasama UiTM)", "Diploma Pengajian Perniagaan", "Diploma Pengurusan Sumber Manusia", "Diploma Pengurusan Pejabat", "Diploma Pengurusan Pentadbiran / Pentadbiran Awam", "Diploma Perakaunan", "Diploma Kewangan Islam", "Bachelor of Business Administration (Hons)"
      ],
      "Fakulti Sains Kesihatan & Pendidikan": [
        "Pra Diploma Sains (Usahasama UiTM)", "Diploma Sains (Usahasama UiTM)", "Diploma Farmasi", "Diploma Pendidikan Awal Kanak-Kanak", "Diploma Keselamatan & Kesihatan Pekerjaan / Occupational Safety & Health (Usahasama UoC)", "Diploma Psikologi (Usahasama UoC)"
      ],
      "Pengajian Pascasiswazah (Postgraduate)": [
        "Doctor of Business Administration (DBA)", "Master of Science (MSc) Management by Research", "Master in Education (MEd)"
      ]
    };
    const select = document.createElement("select"); select.id = "registerProgram"; select.name = "program"; select.required = true;
    select.innerHTML = `<option value="" selected disabled>Pilih program / kursus</option>` + Object.entries(groups).map(([label, options]) => `<optgroup label="${label}">${options.map(option => `<option value="${option}">${option}</option>`).join("")}</optgroup>`).join("");
    programInput.replaceWith(select);
  }
  const start = qs("#registerStart"); const end = qs("#registerEnd"); const today = isoDate(new Date());
  start.value = start.value || today; end.value = end.value || isoDate(new Date(new Date().setMonth(new Date().getMonth() + 4)));
  form.addEventListener("submit", async event => {
    event.preventDefault(); const error = qs("#registerMsg"); const success = qs("#registerSuccess"); error.hidden = true; success.hidden = true;
    const payload = { id: qs("#registerMatrik").value.trim().toUpperCase(), name: qs("#registerName").value.trim(), password: qs("#registerPassword").value, confirmPassword: qs("#registerConfirm").value, program: qs("#registerProgram").value.trim(), company: qs("#registerCompany").value.trim(), address: qs("#registerAddress").value.trim(), industrySupervisor: qs("#registerIndustrySupervisor").value.trim(), supervisorPhone: qs("#registerSupervisorPhone").value.trim(), startDate: start.value, endDate: end.value };
    try { const result = await api("/api/register", { method: "POST", body: JSON.stringify(payload) }); saveSession({ role: result.role, id: result.id }); success.textContent = "Pendaftaran berjaya. Membuka dashboard..."; success.hidden = false; setTimeout(() => { location.href = result.redirect; }, 650); } catch (err) { error.textContent = err.message || "Pendaftaran tidak berjaya."; error.hidden = false; }
  });
}

async function loadCurrentStudent() { const current = requireRole("student"); if (!current) return null; return api(`/api/students/${encodeURIComponent(current.id)}`); }

function renderCalendar(student, selectedMonth) {
  const mount = qs("#attendanceCalendar"); if (!mount) return;
  const { entries } = progressFor(student); const byDate = new Map(entries.map(entry => [entry.date, entry]));
  const days = studentPeriod(student).filter(day => day.startsWith(selectedMonth)); const first = new Date(`${days[0]}T00:00:00`).getDay();
  const offset = (first + 6) % 7; const names = ["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Aha"];
  mount.innerHTML = names.map(name => `<div class="day-name">${name}</div>`).join("") + Array.from({ length: offset }, () => `<div></div>`).join("") + days.map(day => { const entry = byDate.get(day); const status = entry?.attendance === "leave" ? "leave" : entry ? "present" : "missing"; return `<div class="day-cell ${status} ${day === isoDate(new Date()) ? "today" : ""}" title="${entry ? "Catatan telah diisi" : "Klik untuk isi catatan"}"><strong>${Number(day.slice(-2))}</strong><button data-calendar-date="${day}" aria-label="Buka catatan ${day}"></button></div>`; }).join("");
  qsa("[data-calendar-date]", mount).forEach(button => button.addEventListener("click", () => { location.href = `log.html?date=${button.dataset.calendarDate}`; }));
}

async function initDigitalDashboard() {
  const student = await loadCurrentStudent(); if (!student) return; sideIdentity(student); const info = progressFor(student); const rate = info.total ? Math.round(info.logged / info.total * 100) : 0;
  qs("#welcomeName").textContent = `Selamat datang, ${student.name.split(" ")[0]}`; qs("#todayLabel").textContent = prettyDate(isoDate(new Date()), { day:"numeric", month:"long", year:"numeric" });
  qs("#progressTitle").textContent = `${rate}% lengkap`; qs("#progressMeta").textContent = `${info.logged} daripada ${info.total} hari direkodkan`; qs("#progressPercent").textContent = `${rate}%`; qs("#progressRing").style.background = `conic-gradient(#fff ${rate * 3.6}deg,#ffffff32 0deg)`;
  qs("#daysRecorded").textContent = `${info.logged} / ${info.total}`; qs("#daysHint").textContent = info.total - info.logged ? `${info.total - info.logged} hari belum diisi` : "Semua hari lengkap"; qs("#attendanceRate").textContent = `${Math.round(info.entries.filter(e => e.attendance !== "leave").length / Math.max(1, info.logged) * 100)}%`; qs("#attendanceHint").textContent = "Berdasarkan catatan harian"; qs("#pendingCount").textContent = info.entries.filter(e => e.status !== "approved").length; qs("#currentScore").textContent = student.logs.length ? "—" : "—";
  const select = qs("#monthSelect"); const months = monthKeys(student); select.innerHTML = months.map(key => `<option value="${key}">${monthName(key)}</option>`).join(""); select.value = new Date().toISOString().slice(0, 7); if (!months.includes(select.value)) select.value = months[0]; renderCalendar(student, select.value); select.addEventListener("change", () => renderCalendar(student, select.value));
  const missing = info.days.filter(day => !new Set(info.entries.map(e => e.date)).has(day)).slice(0, 3); qs("#actionList").innerHTML = missing.length ? missing.map(day => `<div class="action-item"><span class="action-mark">!</span><div><strong>Catatan ${prettyDate(day)}</strong><span>Hari ini masih belum diisi</span></div></div>`).join("") : `<div class="action-item"><span class="action-mark" style="background:#e8f7ef;color:#177849">✓</span><div><strong>Buku log lengkap</strong><span>Semua hari dalam tempoh latihan telah diisi.</span></div></div>`;
  const recent = [...info.entries].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5); qs("#recentLogs").innerHTML = recent.length ? recent.map(entry => `<div class="recent-row"><span class="recent-date">${prettyDate(entry.date)}</span><div><strong>${entry.duty || "Aktiviti kerja"}</strong><p>${entry.activity}</p></div><span class="status-pill ${entry.status === "approved" ? "success" : "warning"}">${entry.status === "approved" ? "Disahkan" : "Menunggu"}</span></div>`).join("") : `<div class="empty-state">Belum ada catatan. Mulakan dengan mengisi rekod hari ini.</div>`;
  qs("#placementDetails").innerHTML = [["Nama pelatih", student.name],["No. matrik",student.id],["Program",student.program],["Nama industri",student.company],["Alamat industri",student.address],["Penyelia industri",student.industrySupervisor],["Penyelia universiti",student.universitySupervisor],["Tempoh LI",`${prettyDate(student.startDate)} – ${prettyDate(student.endDate)}`]].map(([label,value]) => `<div class="mini-detail"><small>${label}</small><strong>${value || "—"}</strong></div>`).join("");
}

function renderLogSide(student) { const info = progressFor(student); const rate = info.total ? Math.round(info.logged / info.total * 100) : 0; qs("#logProgressValue").textContent = `${rate}%`; qs("#logProgressText").textContent = `${info.logged} / ${info.total} hari lengkap`; qs("#logProgressBar").style.width = `${rate}%`; const counts = new Map(); info.entries.forEach(e => counts.set(e.date.slice(0,7), (counts.get(e.date.slice(0,7)) || 0) + 1)); qs("#monthChecklist").innerHTML = monthKeys(student).map(key => { const total = info.days.filter(day => day.startsWith(key)).length; const done = counts.get(key) || 0; return `<div class="month-check"><strong>${monthName(key)}</strong><span>${done}/${total} hari</span></div>`; }).join(""); const filter = qs("#historyFilter"); filter.innerHTML = `<option value="all">Semua bulan</option>` + monthKeys(student).map(key => `<option value="${key}">${monthName(key)}</option>`).join(""); }

function renderDailyHistory(student, filter = "all") { const entries = mergeEntries(student).filter(e => filter === "all" || e.date.startsWith(filter)).sort((a,b) => b.date.localeCompare(a.date)); qs("#dailyHistory").innerHTML = entries.length ? entries.map(entry => `<article class="history-item"><span class="recent-date">${prettyDate(entry.date)}</span><div><strong>${entry.duty || "Aktiviti kerja"}</strong><p>${entry.activity}${entry.learning ? ` · ${entry.learning}` : ""}</p></div><span class="status-pill ${entry.status === "approved" ? "success" : "warning"}">${entry.status === "approved" ? "Disahkan" : "Menunggu"}</span></article>`).join("") : `<div class="empty-state">Tiada catatan untuk pilihan ini.</div>`; }

async function initDigitalLog() { const student = await loadCurrentStudent(); if (!student) return; sideIdentity(student); const params = new URLSearchParams(location.search); qs("#dailyDate").value = params.get("date") || isoDate(new Date()); renderLogSide(student); renderDailyHistory(student); qs("#historyFilter").addEventListener("change", e => renderDailyHistory(student, e.target.value)); qs("#clearDaily").addEventListener("click", () => qs("#dailyLogForm").reset()); const form = qs("#dailyLogForm"); form.addEventListener("submit", event => { event.preventDefault(); const date = qs("#dailyDate").value; const entries = mergeEntries(student).filter(item => item.date !== date); entries.push({ date, time: qs("#dailyTime").value, duty: qs("#dailyDuty").value.trim(), activity: qs("#dailyActivity").value.trim(), learning: qs("#dailyLearning").value.trim(), status: "pending", attendance: "present" }); writeDaily(student.id, entries.sort((a,b) => a.date.localeCompare(b.date))); const msg = qs("#dailyMsg"); msg.textContent = `Catatan ${prettyDate(date)} berjaya disimpan.`; msg.hidden = false; renderLogSide(student); renderDailyHistory(student); setTimeout(() => msg.hidden = true, 3500); }); const existing = mergeEntries(student).find(item => item.date === qs("#dailyDate").value); if (existing) { qs("#dailyTime").value = existing.time || ""; qs("#dailyDuty").value = existing.duty || ""; qs("#dailyActivity").value = existing.activity || ""; qs("#dailyLearning").value = existing.learning || ""; qs("#formTitle").textContent = "Kemas kini catatan harian"; qs("#requiredBadge").textContent = "Sudah diisi"; qs("#requiredBadge").className = "status-pill success"; } }

async function initDigitalAdmin() { const current = requireRole(["admin", "supervisor"]); if (!current) return; const students = await api("/api/students"); const totalDays = students.reduce((sum,s) => sum + progressFor(s).total, 0); const allEntries = students.flatMap(s => progressFor(s).entries); qs("#adminStats").innerHTML = [["👥","Jumlah pelajar",students.length,"Dalam seliaan"],["✓","Catatan diterima",allEntries.length,"Rekod harian"],["◷","Menunggu semakan",allEntries.filter(e=>e.status!=="approved").length,"Perlu tindakan"],["▣","Kehadiran keseluruhan",`${totalDays ? Math.round(allEntries.length/totalDays*100) : 0}%`,"Daripada tempoh latihan"]].map(([icon,label,value,sub])=>`<div class="metric-card"><span class="metric-icon blue">${icon}</span><div><small>${label}</small><strong>${value}</strong><span>${sub}</span></div></div>`).join(""); qs("#adminTools").innerHTML = [["✓","Semak catatan harian","Lihat catatan yang masih menunggu pengesahan."],["▣","Pantau kehadiran","Kenal pasti hari yang belum direkodkan."],["★","Penilaian pelajar","Lengkapkan Skema B, C dan D."]].map(([icon,title,desc])=>`<button class="tool-card"><strong>${icon} &nbsp; ${title}</strong><span>${desc}</span></button>`).join(""); const render = (term="") => { const filtered = students.filter(s => `${s.name} ${s.id} ${s.company}`.toLowerCase().includes(term.toLowerCase())); qs("#studentList").innerHTML = filtered.map(s => { const info=progressFor(s); const pending=info.entries.filter(e=>e.status!=="approved").length; const rate=info.total?Math.round(info.logged/info.total*100):0; return `<tr><td><strong>${s.name}</strong><br><small>${s.id}</small></td><td>${s.company}</td><td><span class="status-pill ${rate===100?"success":"warning"}">${rate}% · ${info.logged}/${info.total} hari</span></td><td>${pending || "—"}</td><td><a class="btn-small" href="report.html?student=${encodeURIComponent(s.id)}&period=weekly">Buka</a></td></tr>`; }).join("") || `<tr><td colspan="5" class="empty-state">Tiada pelajar ditemui.</td></tr>`; }; qs("#studentSearch").addEventListener("input", e => render(e.target.value)); render(); }

initLogout(); initLogin(); initRegister();
const page = document.body.dataset.page;
if (page === "student-dashboard") initDigitalDashboard();
if (page === "admin") initDigitalAdmin();
if (page === "log") initDigitalLog();
if (page === "admin-report") initAdminReport();
if (page === "my-report") initMyReport();
