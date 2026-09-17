/**
 * LineWebhook.js — รับ webhook จาก LINE Messaging API (doPost) + ตัว conversation state machine
 *
 * ⚠️ ข้อจำกัดสำคัญของ Google Apps Script ที่ต้องรู้ก่อนใช้งานจริง:
 * Apps Script web app (doPost) **ไม่สามารถอ่าน HTTP request header ได้เลย** (ไม่มี e.headers ให้ใช้ -
 * เป็นข้อจำกัดของแพลตฟอร์ม ไม่ใช่ bug ของโค้ดนี้) ซึ่งหมายความว่า **verify ลายเซ็น X-Line-Signature
 * (HMAC-SHA256) ตามมาตรฐานของ LINE ทำไม่ได้จริงบน GAS**
 *
 * ทางแก้ที่ใช้แทนในระบบนี้: ผูก secret token ไว้ใน query string ของ webhook URL เอง
 * (เช่น https://script.google.com/macros/s/XXXX/exec?wh=<WEBHOOK_SECRET>) แล้วเช็คค่านี้แทน
 * — ไม่ใช่การพิสูจน์ทางคริปโตเหมือน LINE signature จริง แต่เป็นเกราะป้องกันในระดับที่ GAS ทำได้
 * (คนอื่นต้องรู้ query string ลับก่อนถึงจะยิง event ปลอมเข้ามาได้)
 * ตั้งค่า WEBHOOK_SECRET ที่หน้า setup.html ของ frontend (เก็บในชีต Setting) แล้วเอาไปต่อท้าย URL ตอนลงทะเบียนใน LINE Developers Console
 */

function verifyWebhookRequest_(e) {
  var expected = getConfig_('WEBHOOK_SECRET');
  if (!expected) return true; // ยังไม่ได้ตั้งค่า — อนุญาตผ่าน (ควรตั้งก่อนใช้งานจริงเสมอ)
  return e.parameter && e.parameter.wh === expected;
}

function doPost(e) {
  // frontend ภายนอก (GitHub Pages) เรียก JSON API ผ่าน endpoint เดียวกัน — แยกทางด้วย body.action (ดู Api.js)
  if (isApiRequest_(e)) return handleApiRequest_(e);
  try {
    if (!verifyWebhookRequest_(e)) {
      Logger.log('[doPost] rejected: bad webhook secret');
      return jsonOutput_({ ok: false });
    }
    var body = JSON.parse(e.postData.contents || '{}');
    var events = body.events || [];
    events.forEach(function (ev) {
      try {
        handleLineEvent_(ev);
      } catch (err) {
        Logger.log('[doPost] event error: ' + (err.stack || err));
      }
    });
    return jsonOutput_({ ok: true });
  } catch (err) {
    Logger.log('[doPost] ' + (err.stack || err));
    return jsonOutput_({ ok: false });
  }
}

function handleLineEvent_(ev) {
  var userId = ev.source && ev.source.userId;
  if (!userId) return; // group/room event ที่ไม่ใช่จาก user โดยตรง — ข้าม

  if (ev.type === 'follow') return handleFollow_(userId, ev.replyToken);
  if (ev.type === 'unfollow') return; // ไม่ต้องตอบ (ตอบไม่ได้อยู่แล้ว)
  if (ev.type === 'message') {
    var msg = ev.message;
    if (msg.type === 'text') return handleTextMessage_(userId, msg.text, ev.replyToken);
    if (msg.type === 'image' || msg.type === 'file' || msg.type === 'video') {
      return handleMediaMessage_(userId, msg, ev.replyToken);
    }
    // sticker ฯลฯ — log ไว้เฉย ๆ ไม่ตอบอัตโนมัติ
    var member0 = findMemberByLineUserId_(userId);
    logChatMessage_(userId, member0 ? member0.MemberNo : '', 'IN', msg.type, '', '');
    touchChatThread_(userId, member0, 'IN', '[' + msg.type + ']');
    return;
  }
}

function handleFollow_(userId, replyToken) {
  resetChatState_(userId);
  lineReply_(replyToken, { type: 'text', text: 'สวัสดีค่ะ/ครับ ยินดีต้อนรับสู่ระบบ LINE สหกรณ์ออมทรัพย์สาธารณสุขจังหวัดมุกดาหาร 🙏\n\n' +
    'กรุณายืนยันตัวตนสมาชิกก่อนใช้งาน โดยพิมพ์ "เลขที่สมาชิก เลขบัตรประชาชน" คั่นด้วยช่องว่าง เช่น\n00123 3490500123456' });
}

var MENU_TEXT = 'เมนูบริการ:\n1) พิมพ์ "เบิกสวัสดิการ" — ยื่นขอรับสวัสดิการ\n2) พิมพ์ "ส่งสลิป" — ส่งหลักฐานการโอนเงิน\n3) พิมพ์ "เช็คสถานะ" — ดูสถานะคำขอสวัสดิการ\n4) พิมพ์ข้อความอื่น ๆ — ติดต่อเจ้าหน้าที่โดยตรง';

function handleTextMessage_(userId, rawText, replyToken) {
  var text = String(rawText || '').trim();
  var member = findMemberByLineUserId_(userId);

  // ---------- ยังไม่ยืนยันตัวตน ----------
  if (!member) {
    var parts = text.split(/\s+/);
    if (parts.length === 2 && isValidNationalId_(parts[1])) {
      try {
        member = verifyAndLinkMember_(userId, parts[0], parts[1]);
        lineReply_(replyToken, [
          { type: 'text', text: 'ยืนยันตัวตนสำเร็จ ✅ สวัสดีคุณ' + memberDisplayName_(member) },
          { type: 'text', text: MENU_TEXT }
        ]);
      } catch (err) {
        lineReply_(replyToken, { type: 'text', text: '⚠️ ' + err.message });
      }
    } else {
      lineReply_(replyToken, { type: 'text', text: 'กรุณายืนยันตัวตนก่อน โดยพิมพ์ "เลขที่สมาชิก เลขบัตรประชาชน" คั่นด้วยช่องว่าง เช่น\n00123 3490500123456' });
    }
    return;
  }

  logChatMessage_(userId, member.MemberNo, 'IN', 'text', text, '');
  var state = getChatState_(userId);

  // ---------- กำลังรอวันที่เหตุการณ์ของคำขอสวัสดิการ ----------
  if (state.mode === CHAT_MODE.AWAIT_WELFARE_EVENT_DATE) {
    return handleWelfareEventDate_(member, userId, state, text, replyToken);
  }

  // ---------- กำลังรอเลือกประเภทสวัสดิการ ----------
  if (state.mode === CHAT_MODE.AWAIT_WELFARE_TYPE) {
    var typeKey = matchWelfareType_(text);
    if (!typeKey) {
      lineReply_(replyToken, { type: 'text', text: 'กรุณาเลือกประเภทตามปุ่ม หรือพิมพ์ชื่อประเภทให้ตรง: รักษาพยาบาล / รับขวัญทายาทใหม่ / สงเคราะห์ศพบิดามารดาบุตร / มงคลสมรส' });
      return;
    }
    setChatState_(userId, { mode: CHAT_MODE.AWAIT_WELFARE_EVENT_DATE, pendingType: typeKey });
    lineReply_(replyToken, { type: 'text', text: 'กรุณาระบุ' + WELFARE_RULES[typeKey].eventDateLabel + ' รูปแบบ วัน/เดือน/ปี เช่น 15/03/2569' });
    return;
  }

  // ---------- กำลังรอเอกสารของคำขอสวัสดิการ ----------
  if (state.mode === CHAT_MODE.AWAIT_WELFARE_DOCS) {
    if (/^(ส่ง(เอกสาร)?ครบ(แล้ว)?|เสร็จ(แล้ว)?)$/.test(text.replace(/\s+/g, ''))) {
      try {
        submitWelfareClaimForReview_(state.claimId);
        resetChatState_(userId);
        lineReply_(replyToken, { type: 'text', text: '✅ ส่งคำขอเรียบร้อย เจ้าหน้าที่จะตรวจสอบและแจ้งผลกลับทาง LINE นี้' });
      } catch (err) {
        lineReply_(replyToken, { type: 'text', text: '⚠️ ' + err.message });
      }
      return;
    }
    lineReply_(replyToken, { type: 'text', text: 'กรุณาส่งรูป/ไฟล์เอกสารเข้ามา แล้วพิมพ์ "ส่งครบแล้ว" เมื่อส่งครบทุกไฟล์' });
    return;
  }

  // ---------- กำลังรอยืนยันหมวดของไฟล์ที่เพิ่งส่ง ----------
  if (state.mode === CHAT_MODE.AWAIT_UPLOAD_CATEGORY_CONFIRM) {
    handleUploadCategoryConfirm_(member, userId, state, text, replyToken);
    return;
  }

  // ---------- คำสั่งเมนูหลัก ----------
  if (/^เมนู$/.test(text)) { lineReply_(replyToken, { type: 'text', text: MENU_TEXT }); return; }

  if (/^เบิกสวัสดิการ$/.test(text)) {
    setChatState_(userId, { mode: CHAT_MODE.AWAIT_WELFARE_TYPE });
    lineReply_(replyToken, {
      type: 'text', text: 'เลือกประเภทสวัสดิการที่ต้องการยื่นขอ:\n- รักษาพยาบาล (1,000 บาท/ครั้ง ไม่เกิน 3 ครั้ง/ปี)\n- รับขวัญทายาทใหม่ (1,000 บาท/ครั้ง ไม่เกิน 3 คน)\n- สงเคราะห์ศพบิดามารดาบุตร (10,000 บาท/ศพ)\n- มงคลสมรส (1,000 บาท ครั้งเดียว)\n\nพิมพ์ชื่อประเภทที่ต้องการ',
      quickReply: lineQuickReply_([
        { label: 'รักษาพยาบาล', text: 'รักษาพยาบาล' },
        { label: 'รับขวัญทายาทใหม่', text: 'รับขวัญทายาทใหม่' },
        { label: 'สงเคราะห์ศพ', text: 'สงเคราะห์ศพบิดามารดาบุตร' },
        { label: 'มงคลสมรส', text: 'มงคลสมรส' }
      ])
    });
    return;
  }

  if (/^ส่งสลิป/.test(text)) {
    setChatState_(userId, { mode: CHAT_MODE.AWAIT_SLIP });
    lineReply_(replyToken, { type: 'text', text: 'กรุณาส่งรูปสลิปโอนเงินเข้ามาได้เลยค่ะ/ครับ' });
    return;
  }

  if (/^เช็คสถานะ/.test(text)) {
    lineReply_(replyToken, { type: 'text', text: buildMyClaimsSummary_(member.MemberNo) });
    return;
  }

  // ---------- ข้อความทั่วไป — ส่งต่อเจ้าหน้าที่ ----------
  touchChatThread_(userId, member, 'IN', text);
  lineReply_(replyToken, { type: 'text', text: 'ข้อความของท่านถูกบันทึกแล้ว เจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุด (พิมพ์ "เมนู" เพื่อดูบริการอื่น ๆ)' });
}

function matchWelfareType_(text) {
  var t = text.replace(/\s+/g, '');
  if (/รักษาพยาบาล/.test(t)) return 'MEDICAL';
  if (/รับขวัญ|ทายาท/.test(t)) return 'NEWBORN';
  if (/สงเคราะห์ศพ|ศพ/.test(t)) return 'FUNERAL';
  if (/สมรส|แต่งงาน/.test(t)) return 'MARRIAGE';
  return null;
}

function handleWelfareEventDate_(member, userId, state, text, replyToken) {
  var d = parseThaiDate_(text);
  if (!d) {
    lineReply_(replyToken, { type: 'text', text: 'รูปแบบวันที่ไม่ถูกต้อง กรุณาพิมพ์เป็น วัน/เดือน/ปี เช่น 15/03/2569' });
    return;
  }
  var type = state.pendingType;
  var elig;
  try {
    elig = computeEligibility_(member.MemberNo, type, d);
  } catch (err) {
    lineReply_(replyToken, { type: 'text', text: '⚠️ ' + err.message });
    resetChatState_(userId);
    return;
  }
  if (!elig.eligible) {
    resetChatState_(userId);
    lineReply_(replyToken, { type: 'text', text: '❌ ไม่สามารถยื่นคำขอนี้ได้: ' + elig.reason });
    return;
  }
  var claimId = createWelfareClaim_(member, userId, type, d, elig.deadlineDate);
  setChatState_(userId, { mode: CHAT_MODE.AWAIT_WELFARE_DOCS, claimId: claimId });
  var rule = WELFARE_RULES[type];
  lineReply_(replyToken, { type: 'text', text: '✅ เริ่มคำขอ "' + rule.label + '" แล้ว (เลขที่คำขอ ' + claimId + ')\n\n' +
    'กรุณาส่งเอกสารดังนี้ (ถ่ายรูปหรือแนบไฟล์ทีละอย่าง):\n- ' + rule.requiredDocs.join('\n- ') + '\n\n' +
    'ส่งครบแล้วพิมพ์ "ส่งครบแล้ว"' });
}

function buildMyClaimsSummary_(memberNo) {
  var rows = readSheet_(getSheet_(SHEET_NAMES.WELFARE_CLAIMS)).filter(function (r) { return String(r.MemberNo) === String(memberNo); });
  if (!rows.length) return 'ยังไม่มีประวัติการยื่นขอสวัสดิการ';
  rows.sort(function (a, b) { return new Date(b.SubmittedAt) - new Date(a.SubmittedAt); });
  var statusLabel = { DRAFT: 'รอส่งเอกสาร', SUBMITTED: 'รอตรวจสอบ', UNDER_REVIEW: 'กำลังตรวจสอบ', APPROVED: 'อนุมัติแล้ว รอจ่ายเงิน', REJECTED: 'ไม่อนุมัติ', PAID: 'จ่ายเงินแล้ว' };
  return rows.slice(0, 10).map(function (r) {
    return (WELFARE_RULES[r.Type] || {}).label + ' — ' + (statusLabel[r.Status] || r.Status) + ' (' + formatDate_(new Date(r.SubmittedAt), 'dd/MM/yyyy') + ')';
  }).join('\n');
}

function handleMediaMessage_(userId, msg, replyToken) {
  var member = findMemberByLineUserId_(userId);
  if (!member) {
    lineReply_(replyToken, { type: 'text', text: 'กรุณายืนยันตัวตนก่อนส่งไฟล์ พิมพ์ "เลขที่สมาชิก เลขบัตรประชาชน"' });
    return;
  }

  var blob;
  try {
    blob = lineGetContent_(msg.id);
  } catch (err) {
    lineReply_(replyToken, { type: 'text', text: '⚠️ ดาวน์โหลดไฟล์ไม่สำเร็จ กรุณาลองส่งใหม่อีกครั้ง' });
    return;
  }

  var state = getChatState_(userId);

  if (state.mode === CHAT_MODE.AWAIT_WELFARE_DOCS) {
    var fileId = attachWelfareDoc_(state.claimId, blob, msg.type);
    logChatMessage_(userId, member.MemberNo, 'IN', msg.type, '[เอกสารสวัสดิการ]', fileId);
    lineReply_(replyToken, { type: 'text', text: 'รับเอกสารแล้ว ✅ ส่งเพิ่มได้อีกถ้ามี หรือพิมพ์ "ส่งครบแล้ว" เมื่อส่งครบทุกไฟล์' });
    return;
  }

  if (state.mode === CHAT_MODE.AWAIT_SLIP) {
    var slipId = recordPaymentSlip_(member, userId, blob);
    logChatMessage_(userId, member.MemberNo, 'IN', msg.type, '[สลิปโอนเงิน ' + slipId + ']', '');
    resetChatState_(userId);
    lineReply_(replyToken, { type: 'text', text: 'รับสลิปแล้ว ✅ เจ้าหน้าที่จะตรวจสอบและบันทึกยอดให้ครับ/ค่ะ' });
    return;
  }

  // ไม่มี context ชัดเจน — เก็บเข้าอื่นๆ ก่อน แล้วถามหมวดย้อนหลัง
  var uploadId = recordMiscUpload_(member, userId, blob, msg.fileName || (msg.type + '_' + Date.now()));
  logChatMessage_(userId, member.MemberNo, 'IN', msg.type, '[ไฟล์ ' + uploadId + ']', '');
  touchChatThread_(userId, member, 'IN', '[ส่งไฟล์: ' + msg.type + ']');
  setChatState_(userId, { mode: CHAT_MODE.AWAIT_UPLOAD_CATEGORY_CONFIRM, lastUploadId: uploadId });
  lineReply_(replyToken, {
    type: 'text', text: 'รับไฟล์แล้ว — ไฟล์นี้เกี่ยวกับอะไรคะ/ครับ?',
    quickReply: lineQuickReply_([
      { label: 'สลิปโอนเงิน', text: 'หมวดไฟล์: สลิปโอนเงิน' },
      { label: 'อื่นๆ', text: 'หมวดไฟล์: อื่นๆ' }
    ])
  });
}

function handleUploadCategoryConfirm_(member, userId, state, text, replyToken) {
  var uploadId = state.lastUploadId;
  resetChatState_(userId);
  if (!uploadId) { lineReply_(replyToken, { type: 'text', text: MENU_TEXT }); return; }

  var rows = readSheet_(getSheet_(SHEET_NAMES.MISC_UPLOADS));
  var row = rows.find(function (r) { return r.UploadId === uploadId; });
  if (!row) { lineReply_(replyToken, { type: 'text', text: MENU_TEXT }); return; }

  if (/สลิป/.test(text)) {
    updateRowByHeaders_(getSheet_(SHEET_NAMES.MISC_UPLOADS), row.__rowIndex, { Tag: 'สลิปโอนเงิน (ระบุย้อนหลัง)' });
    appendRowByHeaders_(getSheet_(SHEET_NAMES.PAYMENT_SLIPS), {
      SlipId: newId_('SLIP'), MemberNo: member.MemberNo, LineUserId: userId,
      DriveFileId: row.DriveFileId, UploadedAt: nowIso_(), Note: 'ย้ายมาจากไฟล์ไม่ระบุหมวด',
      Status: 'NEW', HandledBy: '', HandledAt: ''
    });
    SpreadsheetApp.flush();
    lineReply_(replyToken, { type: 'text', text: 'บันทึกเป็นสลิปโอนเงินแล้ว ✅ เจ้าหน้าที่จะตรวจสอบต่อไป' });
    return;
  }

  updateRowByHeaders_(getSheet_(SHEET_NAMES.MISC_UPLOADS), row.__rowIndex, { Tag: 'อื่นๆ' });
  SpreadsheetApp.flush();
  lineReply_(replyToken, { type: 'text', text: 'รับทราบค่ะ/ครับ บันทึกไว้แล้ว' });
}
