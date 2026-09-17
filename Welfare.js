/**
 * Welfare.js — เบิกสวัสดิการ 4 ประเภท (อิงข้อมูลจริงจากแบบฟอร์มของสหกรณ์)
 *
 * หมายเหตุ: "ปีบัญชี" ของสหกรณ์ (ใช้จำกัดสิทธิ์รักษาพยาบาลไม่เกิน 3 ครั้ง/ปี) สมมติเป็นปีปฏิทิน (ม.ค.-ธ.ค.)
 * ไปก่อนเพราะยังไม่ได้ยืนยันวันเริ่ม/สิ้นปีบัญชีจริงของสหกรณ์ — แก้ไขได้ที่ WELFARE_RULES.MEDICAL.fiscalYearFn
 * ถ้าปีบัญชีสหกรณ์ไม่ตรงปีปฏิทิน ให้เจ้าหน้าที่แจ้งช่วงเวลาที่ถูกต้องมาปรับ
 */

var WELFARE_RULES = {
  MEDICAL: { label: 'รักษาพยาบาล', amount: 1000, maxPerYear: 3, deadlineDays: 90,
    requiredDocs: ['หนังสือรับรองผู้ป่วยใน หรือ ใบเสร็จ/ใบแพทย์ระบุวันนอนโรงพยาบาล', 'สำเนาบัตรประชาชน'],
    eventDateLabel: 'วันที่ออกจากโรงพยาบาล' },
  NEWBORN: { label: 'รับขวัญทายาทใหม่', amount: 1000, maxCount: 3, deadlineDays: 120,
    requiredDocs: ['สำเนาสูติบัตร', 'สำเนาทะเบียนสมรส', 'สำเนาบัตรประชาชน'],
    eventDateLabel: 'วันที่คลอด' },
  FUNERAL: { label: 'สงเคราะห์ศพบิดามารดาบุตร', amount: 10000, maxCount: null, deadlineDays: 90,
    requiredDocs: ['สำเนาใบมรณะบัตร', 'สำเนาบัตรประชาชนผู้เสียชีวิต', 'สำเนาทะเบียนบ้านผู้เสียชีวิต', 'สำเนาบัตรประชาชนผู้ขอรับทุน', 'สำเนาทะเบียนบ้านผู้ขอรับทุน'],
    eventDateLabel: 'วันที่เสียชีวิต' },
  MARRIAGE: { label: 'มงคลสมรส', amount: 1000, maxCount: 1, deadlineDays: 90,
    requiredDocs: ['สำเนาทะเบียนสมรส', 'สำเนาบัตรประชาชน'],
    eventDateLabel: 'วันที่จดทะเบียนสมรส' }
};

var WELFARE_STATUS = {
  DRAFT: 'DRAFT',                 // เริ่มยื่น รอแนบเอกสาร
  SUBMITTED: 'SUBMITTED',         // ส่งเอกสารครบ รอเจ้าหน้าที่ตรวจ
  UNDER_REVIEW: 'UNDER_REVIEW',   // เจ้าหน้าที่กำลังตรวจ/เสนออนุมัติ
  APPROVED: 'APPROVED',           // อนุมัติแล้ว (บันทึกผลจากการอนุมัตินอกระบบ) รอจ่ายเงิน
  REJECTED: 'REJECTED',
  PAID: 'PAID'
};

function currentFiscalYearRange_() {
  var now = new Date();
  return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
}

function listClaimsForMember_(memberNo, type) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.WELFARE_CLAIMS));
  return rows.filter(function (r) {
    return String(r.MemberNo) === String(memberNo) && (!type || r.Type === type) && r.Status !== WELFARE_STATUS.REJECTED;
  });
}

/** เช็คสิทธิ์คงเหลือ + กำหนดเวลา ก่อนเริ่มยื่นคำขอ */
function computeEligibility_(memberNo, type, eventDate) {
  var rule = WELFARE_RULES[type];
  if (!rule) throw new Error('ไม่รู้จักประเภทสวัสดิการ: ' + type);

  var deadline = new Date(eventDate.getTime() + rule.deadlineDays * 24 * 60 * 60 * 1000);
  var now = new Date();
  if (now > deadline) {
    return { eligible: false, reason: 'เกินกำหนดเวลายื่นคำขอ (ภายใน ' + rule.deadlineDays + ' วัน นับแต่' + rule.eventDateLabel + ') กรุณาติดต่อเจ้าหน้าที่', deadlineDate: deadline };
  }

  var claims = listClaimsForMember_(memberNo, type);

  if (type === 'MEDICAL') {
    var fy = currentFiscalYearRange_();
    var countThisYear = claims.filter(function (c) {
      var d = new Date(c.SubmittedAt);
      return d >= fy.start && d <= fy.end;
    }).length;
    if (countThisYear >= rule.maxPerYear) {
      return { eligible: false, reason: 'ใช้สิทธิ์รักษาพยาบาลครบ ' + rule.maxPerYear + ' ครั้งในปีบัญชีนี้แล้ว', deadlineDate: deadline };
    }
    return { eligible: true, remaining: rule.maxPerYear - countThisYear - 1, deadlineDate: deadline };
  }

  if (rule.maxCount != null) {
    if (claims.length >= rule.maxCount) {
      return { eligible: false, reason: 'ใช้สิทธิ์' + rule.label + 'ครบ ' + rule.maxCount + ' ครั้งแล้ว', deadlineDate: deadline };
    }
    return { eligible: true, remaining: rule.maxCount - claims.length - 1, deadlineDate: deadline };
  }

  return { eligible: true, remaining: null, deadlineDate: deadline };
}

/** เริ่มคำขอใหม่ (ยังไม่ผ่านการตรวจสิทธิ์ — เรียก computeEligibility_ ก่อนหน้านี้แล้วจากตัว conversation flow) */
function createWelfareClaim_(member, lineUserId, type, eventDate, deadlineDate) {
  var rule = WELFARE_RULES[type];
  var claimId = newId_('WEL');
  var folder = ensureSubfolder_(
    ensureSubfolder_(ensureMemberFolder_(member.MemberNo), UPLOAD_CATEGORY.WELFARE),
    claimId
  );
  appendRowByHeaders_(getSheet_(SHEET_NAMES.WELFARE_CLAIMS), {
    ClaimId: claimId,
    MemberNo: member.MemberNo,
    LineUserId: lineUserId,
    Type: type,
    AmountBaht: rule.amount,
    SubmittedAt: nowIso_(),
    DeadlineDate: deadlineDate.toISOString(),
    Status: WELFARE_STATUS.DRAFT,
    DriveFolderId: folder.getId(),
    ReviewedBy: '', ReviewedAt: '', PaidAt: '',
    Notes: rule.eventDateLabel + ': ' + formatDate_(eventDate, 'dd/MM/yyyy')
  });
  SpreadsheetApp.flush();
  return claimId;
}

function findClaim_(claimId) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.WELFARE_CLAIMS));
  return rows.find(function (r) { return r.ClaimId === claimId; }) || null;
}

function attachWelfareDoc_(claimId, blob, docType) {
  var claim = findClaim_(claimId);
  if (!claim) throw new Error('ไม่พบคำขอนี้');
  var folder = DriveApp.getFolderById(claim.DriveFolderId);
  var file = folder.createFile(blob);
  appendRowByHeaders_(getSheet_(SHEET_NAMES.WELFARE_DOCS), {
    ClaimId: claimId, DocType: docType || '', DriveFileId: file.getId(),
    FileName: file.getName(), UploadedAt: nowIso_()
  });
  SpreadsheetApp.flush();
  return file.getId();
}

function countClaimDocs_(claimId) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.WELFARE_DOCS));
  return rows.filter(function (r) { return r.ClaimId === claimId; }).length;
}

/** สมาชิกกดยืนยัน "ส่งเอกสารครบแล้ว" — เปลี่ยนสถานะเป็นรอตรวจ + แจ้งเตือนแอดมิน */
function submitWelfareClaimForReview_(claimId) {
  var sheet = getSheet_(SHEET_NAMES.WELFARE_CLAIMS);
  var claim = findClaim_(claimId);
  if (!claim) throw new Error('ไม่พบคำขอนี้');
  var docCount = countClaimDocs_(claimId);
  if (docCount === 0) throw new Error('ยังไม่มีเอกสารแนบมาเลย กรุณาส่งรูป/ไฟล์เอกสารก่อนกดยืนยัน');
  updateRowByHeaders_(sheet, claim.__rowIndex, { Status: WELFARE_STATUS.SUBMITTED });
  SpreadsheetApp.flush();
  var member = findMemberByNo_(claim.MemberNo);
  linePushAdminGroup_('คำขอสวัสดิการใหม่: ' + WELFARE_RULES[claim.Type].label + ' จาก ' + memberDisplayName_(member) +
    ' (เลขที่ ' + claim.MemberNo + ') เอกสาร ' + docCount + ' ไฟล์ — รอตรวจสอบในระบบแอดมิน');
  return claim;
}

// ---------- Admin RPC ----------

function listWelfareClaims_(token, status) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    var rows = readSheet_(getSheet_(SHEET_NAMES.WELFARE_CLAIMS));
    if (status) rows = rows.filter(function (r) { return r.Status === status; });
    rows.sort(function (a, b) { return new Date(b.SubmittedAt) - new Date(a.SubmittedAt); });
    rows.forEach(function (r) {
      var member = findMemberByNo_(r.MemberNo);
      r.MemberName = memberDisplayName_(member);
      r.TypeLabel = (WELFARE_RULES[r.Type] || {}).label || r.Type;
      r.DocCount = countClaimDocs_(r.ClaimId);
    });
    return { ok: true, claims: sanitizeForClient_(rows) };
  } catch (err) {
    Logger.log('[listWelfareClaims_] ' + (err.stack || err));
    return { ok: false, message: translateError_(err) };
  }
}

function getClaimDocs_(token, claimId) {
  try {
    requireAdminSession_(token);
    var rows = readSheet_(getSheet_(SHEET_NAMES.WELFARE_DOCS)).filter(function (r) { return r.ClaimId === claimId; });
    return { ok: true, docs: sanitizeForClient_(rows) };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/**
 * บันทึกผลการอนุมัติ — เป็นการ "บันทึกผลหลังอนุมัตินอกระบบ" ตามที่ตกลงไว้
 * (ประธาน/กรรมการยังอนุมัติแบบเดิมนอกระบบ เจ้าหน้าที่แอดมินเต็มมาติ๊กบันทึกผลในนี้)
 */
function reviewWelfareClaim_(token, claimId, decision, notes) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, message: 'ระบบกำลังประมวลผลคำขออื่น กรุณาลองใหม่ในอีกสักครู่' };
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL]); // เฉพาะแอดมินเต็มเท่านั้นที่บันทึกผลอนุมัติได้

    if (['APPROVED', 'REJECTED'].indexOf(decision) === -1) throw new Error('decision ต้องเป็น APPROVED หรือ REJECTED');

    var sheet = getSheet_(SHEET_NAMES.WELFARE_CLAIMS);
    var claim = findClaim_(claimId);
    if (!claim) throw new Error('ไม่พบคำขอนี้');
    if (claim.Status === WELFARE_STATUS.PAID) throw new Error('คำขอนี้จ่ายเงินไปแล้ว แก้ไขสถานะไม่ได้');

    updateRowByHeaders_(sheet, claim.__rowIndex, {
      Status: decision, ReviewedBy: admin.DisplayName || admin.LineUserId, ReviewedAt: nowIso_(),
      Notes: (claim.Notes || '') + (notes ? ' | ' + notes : '')
    });
    SpreadsheetApp.flush();

    appendRowByHeaders_(getSheet_(SHEET_NAMES.AUDIT_LOG), {
      Timestamp: nowIso_(), Actor: admin.LineUserId, Action: 'reviewWelfareClaim:' + decision, Target: claimId, Detail: notes || ''
    });

    var member = findMemberByNo_(claim.MemberNo);
    if (member && member.LineUserId) {
      var text = decision === 'APPROVED'
        ? '✅ คำขอเบิกสวัสดิการ' + WELFARE_RULES[claim.Type].label + ' ของท่านได้รับการอนุมัติแล้ว เจ้าหน้าที่การเงินจะดำเนินการจ่ายเงินต่อไป'
        : '❌ คำขอเบิกสวัสดิการ' + WELFARE_RULES[claim.Type].label + ' ของท่านไม่ได้รับการอนุมัติ' + (notes ? (' เหตุผล: ' + notes) : '') + ' สอบถามเพิ่มเติมติดต่อเจ้าหน้าที่';
      try { linePush_(member.LineUserId, { type: 'text', text: text }); } catch (e) { Logger.log('[reviewWelfareClaim_] push failed: ' + e); }
    }
    return { ok: true };
  } catch (err) {
    Logger.log('[reviewWelfareClaim_] ' + (err.stack || err));
    return { ok: false, message: translateError_(err) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- LIFF (เรียกผ่าน getMyStatusApi_ ใน Api.js หลังตรวจ LINE ID token แล้วเท่านั้น) ----------

function listMyClaims_(lineUserId) {
  try {
    var member = findMemberByLineUserId_(lineUserId);
    if (!member) return { ok: false, message: 'ยังไม่ได้ยืนยันตัวตนสมาชิก กรุณาพิมพ์ยืนยันตัวตนในแชทก่อน' };
    var rows = readSheet_(getSheet_(SHEET_NAMES.WELFARE_CLAIMS))
      .filter(function (r) { return String(r.MemberNo) === String(member.MemberNo); });
    rows.sort(function (a, b) { return new Date(b.SubmittedAt) - new Date(a.SubmittedAt); });
    rows.forEach(function (r) { r.TypeLabel = (WELFARE_RULES[r.Type] || {}).label || r.Type; });
    return { ok: true, claims: sanitizeForClient_(rows) };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

function markClaimPaid_(token, claimId) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL]);
    var sheet = getSheet_(SHEET_NAMES.WELFARE_CLAIMS);
    var claim = findClaim_(claimId);
    if (!claim) throw new Error('ไม่พบคำขอนี้');
    if (claim.Status !== WELFARE_STATUS.APPROVED) throw new Error('ต้องอนุมัติก่อนจึงบันทึกจ่ายเงินได้');
    updateRowByHeaders_(sheet, claim.__rowIndex, { Status: WELFARE_STATUS.PAID, PaidAt: nowIso_() });
    SpreadsheetApp.flush();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}
