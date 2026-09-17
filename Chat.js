/**
 * Chat.js — บันทึกข้อความ (เข้า/ออก) + สรุป thread ต่อสมาชิก สำหรับหน้า inbox ของแอดมิน
 */

function logChatMessage_(lineUserId, memberNo, direction, msgType, text, driveFileId, handledBy) {
  appendRowByHeaders_(getSheet_(SHEET_NAMES.CHAT_MESSAGES), {
    MessageId: newId_('MSG'),
    LineUserId: lineUserId,
    MemberNo: memberNo || '',
    Direction: direction, // 'IN' | 'OUT'
    MsgType: msgType,     // 'text' | 'image' | 'file' | 'sticker' | 'system'
    Text: text || '',
    DriveFileId: driveFileId || '',
    CreatedAt: nowIso_(),
    HandledBy: handledBy || ''
  });
}

/** อัปเดตแถวสรุป thread — ใช้ตอนรับข้อความเข้า/ตอบออก ให้หน้า inbox ของแอดมิน poll ได้เร็วโดยไม่ต้อง scan ChatMessages ทั้งชีต */
function touchChatThread_(lineUserId, member, direction, lastText) {
  var sheet = getSheet_(SHEET_NAMES.CHAT_THREADS);
  var rows = readSheet_(sheet);
  var row = rows.find(function (r) { return r.LineUserId === lineUserId; });
  var now = nowIso_();
  var patch = {
    MemberNo: member ? member.MemberNo : '',
    MemberName: member ? memberDisplayName_(member) : '(ยังไม่ยืนยันตัวตน)',
    LastMessageAt: now,
    LastMessageText: String(lastText || '').slice(0, 200),
    LastDirection: direction,
    Status: 'OPEN'
  };
  if (direction === 'IN') {
    var prevUnread = row ? Number(row.UnreadCount || 0) : 0;
    patch.UnreadCount = prevUnread + 1;
    if (!row || !row.FirstUnansweredAt) patch.FirstUnansweredAt = now;
  } else {
    patch.UnreadCount = 0;
    patch.FirstUnansweredAt = '';
    patch.AlertedAt = '';
  }
  if (row) {
    updateRowByHeaders_(sheet, row.__rowIndex, patch);
  } else {
    patch.LineUserId = lineUserId;
    if (!patch.FirstUnansweredAt) patch.FirstUnansweredAt = direction === 'IN' ? now : '';
    appendRowByHeaders_(sheet, patch);
  }
}

// ---------- Admin RPC ----------

function listChatThreads_(token) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    var rows = readSheet_(getSheet_(SHEET_NAMES.CHAT_THREADS));
    rows.sort(function (a, b) { return new Date(b.LastMessageAt) - new Date(a.LastMessageAt); });
    return { ok: true, threads: sanitizeForClient_(rows) };
  } catch (err) {
    Logger.log('[listChatThreads_] ' + (err.stack || err));
    return { ok: false, message: translateError_(err) };
  }
}

function getThreadMessages_(token, lineUserId, limit) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    var rows = readSheet_(getSheet_(SHEET_NAMES.CHAT_MESSAGES))
      .filter(function (r) { return r.LineUserId === lineUserId; });
    rows.sort(function (a, b) { return new Date(a.CreatedAt) - new Date(b.CreatedAt); });
    if (limit) rows = rows.slice(-limit);
    return { ok: true, messages: sanitizeForClient_(rows) };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

function sendChatReply_(token, lineUserId, text) {
  try {
    var admin = requireAdminSession_(token);
    requireRole_(admin, [ROLES.ADMIN_FULL, ROLES.CHAT_STAFF]);
    if (!text || !text.trim()) throw new Error('กรุณาพิมพ์ข้อความ');
    linePush_(lineUserId, { type: 'text', text: text });

    var member = findMemberByLineUserId_(lineUserId);
    logChatMessage_(lineUserId, member ? member.MemberNo : '', 'OUT', 'text', text, '', admin.DisplayName || admin.LineUserId);
    touchChatThread_(lineUserId, member, 'OUT', text);
    return { ok: true };
  } catch (err) {
    Logger.log('[sendChatReply_] ' + (err.stack || err));
    return { ok: false, message: translateError_(err) };
  }
}

function markThreadRead_(token, lineUserId) {
  try {
    requireAdminSession_(token);
    var sheet = getSheet_(SHEET_NAMES.CHAT_THREADS);
    var rows = readSheet_(sheet);
    var row = rows.find(function (r) { return r.LineUserId === lineUserId; });
    if (row) updateRowByHeaders_(sheet, row.__rowIndex, { UnreadCount: 0 });
    SpreadsheetApp.flush();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: translateError_(err) };
  }
}

/**
 * เช็คข้อความค้างตอบเกิน 5 นาที แจ้งเตือนกลุ่มแอดมิน — ตั้ง time-driven trigger ทุก 5 นาทีให้เรียกฟังก์ชันนี้
 * (ดูวิธีตั้ง trigger ใน initializeProject / WORKFLOW.md)
 */
function checkUnansweredThreads_() {
  var sheet = getSheet_(SHEET_NAMES.CHAT_THREADS);
  var rows = readSheet_(sheet);
  var now = Date.now();
  var alerted = 0;
  rows.forEach(function (r) {
    if (!r.FirstUnansweredAt || r.AlertedAt) return;
    var waited = now - new Date(r.FirstUnansweredAt).getTime();
    if (waited >= 5 * 60 * 1000) {
      linePushAdminGroup_('⏰ ข้อความจาก ' + (r.MemberName || r.LineUserId) + ' ยังไม่มีใครตอบเกิน 5 นาที กรุณาเข้าไปตอบในระบบแอดมิน');
      updateRowByHeaders_(sheet, r.__rowIndex, { AlertedAt: nowIso_() });
      alerted++;
    }
  });
  if (alerted) SpreadsheetApp.flush();
  return alerted;
}
