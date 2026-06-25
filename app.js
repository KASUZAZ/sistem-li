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
    password: student.password || "Dkm2026",
    name: student.name,
    program: student.program || "Diploma Kejuruteraan Mekanikal",
    company: student.company || "-",
    address: student.address || "-",
    industry_supervisor: student.industrySupervisor || "-",
    university_supervisor: student.universitySupervisor || "IZAH BINTI MD JEDI",
    start_date: student.startDate || "2025-06-02",
    end_date: student.endDate || "2025-11-14"
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
    password: pick(row, ["password", "kata_laluan", "katalaluan"], "Dkm2026"),
    name: pick(row, ["name", "nama", "nama_pelajar"], id),
    program: pick(row, ["program", "kursus"], "Diploma Kejuruteraan Mekanikal"),
    company: pick(row, ["company", "syarikat", "nama_syarikat"], "-"),
    address: pick(row, ["address", "alamat", "alamat_syarikat"], "-"),
    industrySupervisor: pick(row, ["industrysupervisor", "penyelia_industri", "penyeliaindustri"], "-"),
    universitySupervisor: pick(row, ["universitysupervisor", "penyelia_universiti", "penyeliauniversiti"], "IZAH BINTI MD JEDI"),
    startDate: pick(row, ["startdate", "tarikh_mula", "tarikhmula"], "2025-06-02"),
    endDate: pick(row, ["enddate", "tarikh_akhir", "tarikhakhir"], "2025-11-14")
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
  if (!upload.ok) throw new Error(data?.message || "Gagal upload gambar.");
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
    reader.onerror = () => reject(new Error("Gagal membaca gambar."));
    reader.readAsDataURL(file);
  });
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
    ["📁", "Export Data", "Sediakan rekod untuk simpanan pentadbiran."],
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
    "Export Data": "export",
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
    export: () => `
      <div class="box-header"><h2>Export Data</h2><span class="badge-info">Rekod pentadbiran</span></div>
      <div class="tool-actions"><button class="btn primary" type="button">Export Senarai Pelajar</button><button class="btn secondary" type="button">Export Report Mingguan</button><button class="btn secondary" type="button">Export Status Pengesahan</button></div>
      <p class="tool-note">Data tersedia untuk dijadikan CSV/PDF apabila fungsi export sebenar disambungkan.</p>
    `,
    settings: () => `
      <div class="box-header"><h2>Tetapan Sistem</h2><span class="badge-info">Konfigurasi</span></div>
      <div class="tool-summary-grid">
        <div class="mini-panel"><strong>Tempoh LI</strong><span>Jun - Nov 2025</span></div>
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

    const imageInput = qs("#activityImage");
    const activityImage = imageInput ? await fileToDataUrl(imageInput.files[0]) : "";
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
      ${item.activityImage ? `<img class="activity-photo" src="${item.activityImage}" alt="Gambar aktiviti minggu ${item.week}">` : ""}
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

initLogout();
initLogin();

const page = document.body.dataset.page;
if (page === "student-dashboard") initStudentDashboard();
if (page === "admin") initAdmin();
if (page === "log") initLogForm();
if (page === "admin-report") initAdminReport();
if (page === "my-report") initMyReport();
