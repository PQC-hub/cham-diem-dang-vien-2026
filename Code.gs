/**
 * ============================================================
 *  MÁY CHỦ GOOGLE APPS SCRIPT – PHIẾU TỰ CHẤM ĐIỂM ĐẢNG VIÊN (v2)
 *  Đảng ủy xã Đạ Huoai
 * ============================================================
 *  CÁCH CÀI ĐẶT (làm 1 lần):
 *  1. Mở Google Sheets mới → Tiện ích mở rộng → Apps Script → dán toàn bộ file này vào.
 *  2. Trong hàm setupAdminPasscode(), điền mật khẩu quản trị (≥ 10 ký tự) vào NEW_PASSCODE,
 *     chọn hàm setupAdminPasscode ở thanh trên → Chạy (Run) → cấp quyền.
 *     SAU ĐÓ XÓA mật khẩu khỏi file (để lại chuỗi rỗng "") rồi lưu lại.
 *  3. Triển khai → Tùy chọn triển khai mới → Loại: Ứng dụng web
 *       - Thực thi với tư cách: Tôi (Me)
 *       - Người có quyền truy cập: Bất kỳ ai (Anyone)
 *     Sao chép URL kết thúc bằng /exec, dán vào CONFIG.SCRIPT_URL trong index.html.
 *  4. Mỗi lần sửa mã: Triển khai → Quản lý triển khai → Chỉnh sửa → Phiên bản mới.
 *
 *  Dữ liệu ghi vào trang tính "Phieu_v2" (tự tạo). Trang tính cũ không bị đụng tới.
 *  Mật khẩu KHÔNG nằm trong file HTML; danh sách / xóa / sửa phiếu người khác
 *  chỉ thực hiện được khi gửi đúng mật khẩu lên máy chủ.
 * ============================================================
 */

var SHEET_NAME = "Phieu_v2";

var HEADERS = [
  "id", "ownerHash", "fullName", "partyCell", "position", "roleKey", "role",
  "group1", "group2", "total", "unitTotal",
  "rankKey", "rank", "unitRankKey", "unitRank",
  "overachieve", "unitOverachieve", "innovation",
  "selfScores", "unitScores",
  "submittedAt", "updatedAt", "receivedAt", "updatedBy"
];
var IDX = {};
HEADERS.forEach(function (h, i) { IDX[h] = i; });

// Điểm tối đa từng tiêu chí (phải khớp CRITERIA_DATA trong index.html)
var MAX_SCORES = {
  member: [5, 5, 5, 4, 4, 4, 3, 10, 10, 10, 10, 10, 10, 10],
  leader: [1, 1, 1, 1, 1, 1, 1, 2, 1,
           2, 2, 2, 2, 2,
           2.5, 2.5, 2.5, 2.5,
           3, 4, 3,
           2.5, 2.5, 2.5, 2.5,
           5, 5,
           4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3]
};
var GROUP1_COUNT = { member: 7, leader: 18 };

// Ngưỡng xếp loại – ĐỐI CHIẾU LẠI với văn bản chính thức của Quy định 366-QĐ/TW
var RANK_RULES = { excellent: 90, good: 70, pass: 50 };
var RANK_TEXT = {
  XS: "Hoàn thành xuất sắc nhiệm vụ",
  T: "Hoàn thành tốt nhiệm vụ",
  HT: "Hoàn thành nhiệm vụ",
  KHT: "Không hoàn thành nhiệm vụ"
};

/* ---------------- Điểm vào ---------------- */

function doGet() {
  return json_({ ok: true, info: "Máy chủ phiếu tự chấm điểm đảng viên đang hoạt động (v2)." });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    switch (body.action) {
      case "auth":
        checkAdmin_(body.key);
        return json_({ ok: true });
      case "submit":
        return json_(submit_(body));
      case "list":
        checkAdmin_(body.key);
        return json_({ ok: true, data: list_() });
      case "delete":
        checkAdmin_(body.key);
        return json_(delete_(body.id));
      default:
        throw fail_("BAD_REQUEST", "Yêu cầu không hợp lệ.");
    }
  } catch (err) {
    if (!err.code) console.error(err);
    return json_({
      ok: false,
      code: err.code || "ERROR",
      error: err.userMessage || "Lỗi máy chủ, vui lòng thử lại."
    });
  }
}

/* ---------------- Thiết lập mật khẩu ---------------- */

function setupAdminPasscode() {
  var NEW_PASSCODE = ""; // <-- điền mật khẩu (≥ 10 ký tự), chạy hàm, rồi XÓA lại thành ""
  if (String(NEW_PASSCODE).length < 10) {
    throw new Error("Mật khẩu quản trị phải có ít nhất 10 ký tự.");
  }
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty("SALT") || Utilities.getUuid();
  props.setProperty("SALT", salt);
  props.setProperty("ADMIN_HASH", hashWithSalt_(salt, NEW_PASSCODE));
  Logger.log("Đã đặt mật khẩu quản trị. Hãy xóa mật khẩu khỏi mã nguồn.");
}

/* ---------------- Xác thực ---------------- */

function checkAdmin_(key) {
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty("ADMIN_HASH");
  var salt = props.getProperty("SALT");
  if (!stored || !salt) {
    throw fail_("NOSETUP", "Máy chủ chưa thiết lập mật khẩu quản trị (chạy setupAdminPasscode).");
  }
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get("admin_fails") || 0);
  if (fails >= 5) {
    throw fail_("LOCKED", "Nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.");
  }
  if (!key || hashWithSalt_(salt, String(key)) !== stored) {
    cache.put("admin_fails", String(fails + 1), 600);
    throw fail_("AUTH", "Mật khẩu quản trị không đúng.");
  }
  cache.remove("admin_fails");
}

function hashWithSalt_(salt, value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + ":" + value, Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    return ("0" + (b & 0xff).toString(16)).slice(-2);
  }).join("");
}

function ownerHash_(token) {
  var salt = PropertiesService.getScriptProperties().getProperty("SALT");
  if (!salt) throw fail_("NOSETUP", "Máy chủ chưa thiết lập (chạy setupAdminPasscode).");
  return hashWithSalt_(salt, "owner:" + token);
}

/* ---------------- Nghiệp vụ ---------------- */

function submit_(b) {
  var isAdmin = false;
  if (b.key) { checkAdmin_(b.key); isAdmin = true; }
  var clean = validateRecord_(b.record);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var found = findRow_(sheet, clean.id);
    var now = new Date().toISOString();
    var receivedAt = now;
    var ownerH = "";

    if (found) {
      var old = found.values;
      if (!isAdmin) {
        var tok = String(b.ownerToken || "");
        if (tok.length < 16 || ownerHash_(tok) !== String(old[IDX.ownerHash])) {
          throw fail_("OWNER", "Phiếu này đã tồn tại và không thuộc thiết bị đang gửi.");
        }
      } else if (b.baseVersion && String(b.baseVersion) !== String(old[IDX.updatedAt])) {
        throw fail_("CONFLICT", "Phiếu vừa được cập nhật ở nơi khác. Hãy bấm 'Tải mới' rồi sửa lại.");
      }
      ownerH = String(old[IDX.ownerHash]);
      receivedAt = String(old[IDX.receivedAt] || now);
    } else if (!isAdmin) {
      var t = String(b.ownerToken || "");
      if (t.length < 16) throw fail_("BAD_REQUEST", "Thiếu mã chủ phiếu.");
      ownerH = ownerHash_(t);
    }

    var row = HEADERS.map(function () { return ""; });
    row[IDX.id] = clean.id;
    row[IDX.ownerHash] = ownerH;
    row[IDX.fullName] = clean.fullName;
    row[IDX.partyCell] = clean.partyCell;
    row[IDX.position] = clean.position;
    row[IDX.roleKey] = clean.roleKey;
    row[IDX.role] = clean.role;
    row[IDX.group1] = clean.group1;
    row[IDX.group2] = clean.group2;
    row[IDX.total] = clean.total;
    row[IDX.unitTotal] = clean.unitTotal;
    row[IDX.rankKey] = clean.rankKey;
    row[IDX.rank] = clean.rank;
    row[IDX.unitRankKey] = clean.unitRankKey;
    row[IDX.unitRank] = clean.unitRank;
    row[IDX.overachieve] = clean.overachieve;
    row[IDX.unitOverachieve] = clean.unitOverachieve;
    row[IDX.innovation] = clean.innovation;
    row[IDX.selfScores] = JSON.stringify(clean.selfScores);
    row[IDX.unitScores] = JSON.stringify(clean.unitScores);
    row[IDX.submittedAt] = clean.submittedAt;
    row[IDX.updatedAt] = now;
    row[IDX.receivedAt] = receivedAt;
    row[IDX.updatedBy] = isAdmin ? "admin" : "member";

    // Toàn bộ ô là văn bản thuần → không có công thức nào được thực thi
    var values = [row.map(function (v) { return String(v); })];
    var target = found ? found.row : Math.max(sheet.getLastRow(), 1) + 1;
    sheet.getRange(target, 1, 1, HEADERS.length).setNumberFormat("@").setValues(values);

    return {
      ok: true, id: clean.id, receivedAt: receivedAt, updatedAt: now,
      total: clean.total, unitTotal: clean.unitTotal
    };
  } finally {
    lock.releaseLock();
  }
}

function list_() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values.filter(function (r) { return r[IDX.id]; }).map(function (r) {
    return {
      id: String(r[IDX.id]),
      fullName: String(r[IDX.fullName]),
      partyCell: String(r[IDX.partyCell]),
      position: String(r[IDX.position]),
      roleKey: String(r[IDX.roleKey]),
      role: String(r[IDX.role]),
      group1: Number(r[IDX.group1]),
      group2: Number(r[IDX.group2]),
      total: Number(r[IDX.total]),
      unitTotal: Number(r[IDX.unitTotal]),
      rankKey: String(r[IDX.rankKey]),
      rank: String(r[IDX.rank]),
      unitRankKey: String(r[IDX.unitRankKey]),
      unitRank: String(r[IDX.unitRank]),
      overachieve: String(r[IDX.overachieve]) === "true",
      unitOverachieve: String(r[IDX.unitOverachieve]) === "true",
      innovation: String(r[IDX.innovation]),
      selfScores: parseJsonArray_(r[IDX.selfScores]),
      unitScores: parseJsonArray_(r[IDX.unitScores]),
      submittedAt: String(r[IDX.submittedAt]),
      updatedAt: String(r[IDX.updatedAt]),
      receivedAt: String(r[IDX.receivedAt]),
      updatedBy: String(r[IDX.updatedBy])
    };
  });
}

function delete_(id) {
  id = String(id || "");
  if (!id) throw fail_("BAD_REQUEST", "Thiếu mã phiếu.");
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var found = findRow_(sheet, id);
    if (!found) throw fail_("NOT_FOUND", "Không tìm thấy phiếu (có thể đã bị xóa).");
    sheet.deleteRow(found.row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- Kiểm tra dữ liệu ---------------- */

function validateRecord_(r) {
  if (!r || typeof r !== "object") throw fail_("BAD_REQUEST", "Thiếu dữ liệu phiếu.");
  var id = String(r.id || "").trim();
  if (!/^[A-Za-z0-9_\-]{8,64}$/.test(id)) throw fail_("BAD_REQUEST", "Mã phiếu không hợp lệ.");

  var fullName = str_(r.fullName, 100);
  var partyCell = str_(r.partyCell, 100);
  if (!fullName) throw fail_("BAD_REQUEST", "Thiếu họ tên đảng viên.");
  if (!partyCell) throw fail_("BAD_REQUEST", "Thiếu chi bộ sinh hoạt.");

  var roleKey = r.roleKey === "leader" ? "leader" : "member";
  var maxes = MAX_SCORES[roleKey];
  var selfScores = toScores_(r.selfScores, maxes);
  var unitScores = toScores_(r.unitScores || r.selfScores, maxes);

  var s = sums_(selfScores, GROUP1_COUNT[roleKey]);
  var u = sums_(unitScores, GROUP1_COUNT[roleKey]);
  var overachieve = r.overachieve === true;
  var unitOverachieve = r.unitOverachieve === true;
  var rk = rankKey_(s.total, overachieve);
  var urk = rankKey_(u.total, unitOverachieve);

  var submittedAt = String(r.submittedAt || "");
  if (isNaN(Date.parse(submittedAt))) submittedAt = new Date().toISOString();

  return {
    id: id,
    fullName: fullName,
    partyCell: partyCell,
    position: str_(r.position, 200),
    roleKey: roleKey,
    role: str_(r.role, 200),
    group1: s.g1, group2: s.g2, total: s.total, unitTotal: u.total,
    rankKey: rk, rank: RANK_TEXT[rk],
    unitRankKey: urk, unitRank: RANK_TEXT[urk],
    overachieve: overachieve, unitOverachieve: unitOverachieve,
    innovation: str_(r.innovation, 500),
    selfScores: selfScores, unitScores: unitScores,
    submittedAt: submittedAt
  };
}

function toScores_(arr, maxes) {
  if (!Array.isArray(arr) || arr.length !== maxes.length) {
    throw fail_("BAD_REQUEST", "Số tiêu chí chấm điểm không khớp với mẫu phiếu.");
  }
  return arr.map(function (v, i) {
    var n = Number(v);
    if (!isFinite(n) || n < 0 || n > maxes[i] + 1e-9) {
      throw fail_("BAD_REQUEST", "Điểm tiêu chí thứ " + (i + 1) + " không hợp lệ.");
    }
    return Math.round(n * 100) / 100;
  });
}

function sums_(scores, g1Count) {
  var g1 = 0, g2 = 0;
  scores.forEach(function (v, i) { if (i < g1Count) g1 += v; else g2 += v; });
  g1 = Math.round(g1 * 100) / 100;
  g2 = Math.round(g2 * 100) / 100;
  return { g1: g1, g2: g2, total: Math.round((g1 + g2) * 100) / 100 };
}

function rankKey_(total, over) {
  if (total >= RANK_RULES.excellent && over) return "XS";
  if (total >= RANK_RULES.good) return "T";
  if (total >= RANK_RULES.pass) return "HT";
  return "KHT";
}

/* ---------------- Tiện ích ---------------- */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setNumberFormat("@").setValues([HEADERS]);
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, HEADERS.length).setNumberFormat("@");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      var row = i + 2;
      return { row: row, values: sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0] };
    }
  }
  return null;
}

function parseJsonArray_(v) {
  try {
    var a = JSON.parse(String(v));
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

function str_(v, max) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
}

function fail_(code, message) {
  var e = new Error(message);
  e.code = code;
  e.userMessage = message;
  return e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
