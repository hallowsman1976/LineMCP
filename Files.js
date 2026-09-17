/**
 * Files.js — จัดเก็บไฟล์/รูปจาก LINE ลง Drive แยกตามรายสมาชิก แล้วแยก subfolder ตามหมวด
 *   สมาชิก/<เลขที่สมาชิก>/สลิปโอนเงิน/...
 *   สมาชิก/<เลขที่สมาชิก>/เบิกสวัสดิการ/<ClaimId>/...
 *   สมาชิก/<เลขที่สมาชิก>/อื่นๆ/...
 */

var UPLOAD_CATEGORY = {
  SLIP: 'สลิปโอนเงิน',
  WELFARE: 'เบิกสวัสดิการ',
  MISC: 'อื่นๆ'
};

function ensureMemberFolder_(memberNo) {
  var membersRootId = getConfig_('MEMBERS_FOLDER_ID');
  if (!membersRootId) throw new Error('ยังไม่ได้ตั้งค่า MEMBERS_FOLDER_ID — รัน initializeProject() ก่อน');
  var root = DriveApp.getFolderById(membersRootId);
  return createDriveFolderIfMissing_(String(memberNo), root);
}

function ensureSubfolder_(parentFolder, name) {
  return createDriveFolderIfMissing_(name, parentFolder);
}

/** เซฟไฟล์สื่อจาก LINE (blob) ลงโฟลเดอร์ของสมาชิกตามหมวด คืน Drive file */
function saveMemberFile_(memberNo, category, blob, subpath) {
  var memberFolder = ensureMemberFolder_(memberNo);
  var categoryFolder = ensureSubfolder_(memberFolder, category);
  var targetFolder = categoryFolder;
  if (subpath) targetFolder = ensureSubfolder_(categoryFolder, subpath);
  var file = targetFolder.createFile(blob);
  return file;
}

function guessExtensionFromMime_(mime) {
  var map = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'application/pdf': 'pdf', 'video/mp4': 'mp4'
  };
  return map[mime] || 'bin';
}

// ---------- Payment slips (สลิปโอนเงิน) ----------

function recordPaymentSlip_(member, lineUserId, blob, note) {
  var file = saveMemberFile_(member.MemberNo, UPLOAD_CATEGORY.SLIP, blob);
  var sheet = getSheet_(SHEET_NAMES.PAYMENT_SLIPS);
  var slipId = newId_('SLIP');
  appendRowByHeaders_(sheet, {
    SlipId: slipId,
    MemberNo: member.MemberNo,
    LineUserId: lineUserId,
    DriveFileId: file.getId(),
    UploadedAt: nowIso_(),
    Note: note || '',
    Status: 'NEW',
    HandledBy: '',
    HandledAt: ''
  });
  SpreadsheetApp.flush();
  linePushAdminGroup_('มีสลิปโอนเงินใหม่จากสมาชิก ' + memberDisplayName_(member) + ' (เลขที่ ' + member.MemberNo + ') กรุณาตรวจสอบในระบบแอดมิน');
  return slipId;
}

// ---------- Misc uploads (อื่นๆ) ----------

function recordMiscUpload_(member, lineUserId, blob, fileName) {
  var file = saveMemberFile_(member.MemberNo, UPLOAD_CATEGORY.MISC, blob);
  var sheet = getSheet_(SHEET_NAMES.MISC_UPLOADS);
  var uploadId = newId_('UP');
  appendRowByHeaders_(sheet, {
    UploadId: uploadId,
    MemberNo: member.MemberNo,
    LineUserId: lineUserId,
    DriveFileId: file.getId(),
    FileName: fileName || file.getName(),
    UploadedAt: nowIso_(),
    Tag: '',
    TaggedBy: ''
  });
  SpreadsheetApp.flush();
  return uploadId;
}

// ---------- Admin RPC: tag / list uploads ----------

function tagMiscUpload_(token, uploadId, tag) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    var sheet = getSheet_(SHEET_NAMES.MISC_UPLOADS);
    var rows = readSheet_(sheet);
    var row = rows.find(function (r) { return r.UploadId === uploadId; });
    if (!row) throw new Error('ไม่พบไฟล์นี้');
    updateRowByHeaders_(sheet, row.__rowIndex, { Tag: tag, TaggedBy: admin.DisplayName || admin.LineUserId });
    SpreadsheetApp.flush();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

function listPaymentSlips_(token, status) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    var rows = readSheet_(getSheet_(SHEET_NAMES.PAYMENT_SLIPS));
    if (status) rows = rows.filter(function (r) { return r.Status === status; });
    rows.sort(function (a, b) { return new Date(b.UploadedAt) - new Date(a.UploadedAt); });
    return { ok: true, slips: sanitizeForClient_(rows) };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

function markSlipRecorded_(token, slipId) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    var sheet = getSheet_(SHEET_NAMES.PAYMENT_SLIPS);
    var rows = readSheet_(sheet);
    var row = rows.find(function (r) { return r.SlipId === slipId; });
    if (!row) throw new Error('ไม่พบสลิปนี้');
    updateRowByHeaders_(sheet, row.__rowIndex, {
      Status: 'RECORDED', HandledBy: admin.DisplayName || admin.LineUserId, HandledAt: nowIso_()
    });
    SpreadsheetApp.flush();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/** คืนรูปเป็น data URL ให้ admin ดูใน UI (ไฟล์ไม่ public, ไม่ติด CORS — ดู gas-best-practices/drive-ops.md #3) */
function getFileDataUrl_(token, driveFileId) {
  try {
    requireAdminSession_(token);
    var file = DriveApp.getFileById(driveFileId);
    var blob = file.getBlob();
    var mime = blob.getContentType() || 'application/octet-stream';
    var b64 = Utilities.base64Encode(blob.getBytes());
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + b64, fileName: file.getName(), mime: mime };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}
