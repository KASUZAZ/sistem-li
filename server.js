const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataFile = path.join(root, "data", "students.json");
const port = process.env.PORT || 3000;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function readStudents() {
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeStudents(students) {
  fs.writeFileSync(dataFile, JSON.stringify(students, null, 2));
}

function publicStudent(student) {
  const { password, ...safeStudent } = student;
  return safeStudent;
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error("Saiz data terlalu besar."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Format JSON tidak sah."));
      }
    });
  });
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

function reportFor(student, period) {
  const logs = [...student.logs].sort((a, b) => a.week - b.week);
  return {
    student: publicStudent(student),
    period,
    items: period === "monthly" ? getMonthlyReport(logs) : logs
  };
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
    startDate: pick(row, ["startdate", "tarikh_mula", "tarikhmula"], "2025-06-02"),
    endDate: pick(row, ["enddate", "tarikh_akhir", "tarikhakhir"], "2025-11-14"),
    photo: "",
    logs: [],
    signature: {
      supervisorName: "",
      signedAt: "",
      note: ""
    }
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const students = readStudents();

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(req);

    if (body.role === "admin" || body.role === "supervisor") {
      const validAdmin = body.id === "admin" && body.password === "falysa123";
      const validSupervisor =
        body.id.toLowerCase() === "izah@micost.edu.my" &&
        body.password === "penyelia123";

      if (validAdmin) {
        return send(res, 200, { role: "admin", redirect: "admin.html" });
      }

      if (validSupervisor) {
        return send(res, 200, { role: "supervisor", redirect: "admin.html" });
      }
      return send(res, 401, { message: "Login pentadbir tidak sah." });
    }

    const student = students.find(item => item.id === body.id && item.password === body.password);
    if (!student) return send(res, 401, { message: "Login pelajar tidak sah." });
    return send(res, 200, { role: "student", id: student.id, redirect: "dashboard.html" });
  }

  if (req.method === "GET" && url.pathname === "/api/students") {
    return send(res, 200, students.map(publicStudent));
  }

  if (req.method === "POST" && url.pathname === "/api/students/import") {
    const body = await readBody(req);
    const rows = parseCsv(body.csv || "");
    if (rows.length < 2) return send(res, 400, { message: "CSV mesti ada header dan sekurang-kurangnya satu pelajar." });

    const headers = rows[0].map(normalizeHeader);
    let imported = 0;
    let updated = 0;

    rows.slice(1).forEach(values => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || "";
      });

      const student = studentFromCsvRow(row);
      if (!student) return;

      const existingIndex = students.findIndex(item => item.id === student.id);
      if (existingIndex >= 0) {
        students[existingIndex] = {
          ...students[existingIndex],
          ...student,
          logs: students[existingIndex].logs || [],
          signature: students[existingIndex].signature || student.signature
        };
        updated += 1;
      } else {
        students.push(student);
        imported += 1;
      }
    });

    writeStudents(students);
    return send(res, 200, {
      imported,
      updated,
      total: students.length,
      students: students.map(publicStudent)
    });
  }

  if (parts[0] === "api" && parts[1] === "students" && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    const studentIndex = students.findIndex(item => item.id === id);
    if (studentIndex === -1) return send(res, 404, { message: "Pelajar tidak ditemui." });

    const student = students[studentIndex];

    if (req.method === "GET" && parts.length === 3) {
      return send(res, 200, publicStudent(student));
    }

    if (req.method === "GET" && parts[3] === "reports") {
      const period = url.searchParams.get("period") === "monthly" ? "monthly" : "weekly";
      return send(res, 200, reportFor(student, period));
    }

    if (req.method === "POST" && parts[3] === "profile-photo") {
      const body = await readBody(req);
      student.photo = body.photo || "";
      writeStudents(students);
      return send(res, 200, publicStudent(student));
    }

    if (req.method === "POST" && parts[3] === "logs" && parts.length === 4) {
      const body = await readBody(req);
      const week = Number(body.week);
      if (!week || !body.startDate || !body.endDate || !body.activity) {
        return send(res, 400, { message: "Minggu, tarikh dan aktiviti wajib diisi." });
      }

      const log = {
        week,
        startDate: body.startDate,
        endDate: body.endDate,
        activity: body.activity,
        learning: body.learning || "",
        status: "pending",
        activityImage: body.activityImage || ""
      };

      const oldIndex = student.logs.findIndex(item => Number(item.week) === week);
      if (oldIndex >= 0) student.logs[oldIndex] = log;
      else student.logs.push(log);

      writeStudents(students);
      return send(res, 201, publicStudent(student));
    }

    if (req.method === "POST" && parts[3] === "logs" && parts[4] && parts[5] === "status") {
      const week = Number(parts[4]);
      const body = await readBody(req);
      const log = student.logs.find(item => Number(item.week) === week);
      if (!log) return send(res, 404, { message: "Log minggu tidak ditemui." });

      log.status = body.status === "rejected" ? "rejected" : "approved";
      log.approvedBy = body.approvedBy || "IZAH BINTI MD JEDI";
      log.approvedAt = new Date().toISOString();

      writeStudents(students);
      return send(res, 200, publicStudent(student));
    }

    if (req.method === "POST" && parts[3] === "signature") {
      const body = await readBody(req);
      student.signature = {
        supervisorName: body.supervisorName || "",
        note: body.note || "",
        signedAt: new Date().toISOString()
      };
      writeStudents(students);
      return send(res, 200, publicStudent(student));
    }
  }

  send(res, 404, { message: "API tidak ditemui." });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    return send(res, 403, "Akses tidak dibenarkan.", "text/plain; charset=utf-8");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, "Fail tidak ditemui.", "text/plain; charset=utf-8");
    send(res, 200, content, mime[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) return await handleApi(req, res);
    serveStatic(req, res);
  } catch (error) {
    send(res, 500, { message: error.message || "Ralat server." });
  }
});

server.listen(port, () => {
  console.log(`Sistem E-LI berjalan di http://localhost:${port}`);
});
