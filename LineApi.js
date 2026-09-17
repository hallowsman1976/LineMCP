/**
 * LineApi.js — LINE Messaging API client (reply/push/content/profile) + webhook signature check.
 * ค่า config/secret ทั้งหมดอยู่ในชีต "Setting" (แก้ผ่านหน้า setup.html ของ frontend ได้เลย ไม่ต้องเข้า Apps Script editor):
 *   LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET,
 *   LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET,
 *   ADMIN_LINE_GROUP_ID (ไว้ push แจ้งเตือนแอดมิน), WEBAPP_BASE_URL
 */

function lineProp_(key) {
  var v = getConfig_(key);
  if (!v) throw new Error('ยังไม่ได้ตั้งค่า: ' + key + ' — ไปตั้งค่าที่หน้า setup.html ของ frontend ก่อน');
  return v;
}

function lineChannelAccessToken_() {
  return lineProp_('LINE_CHANNEL_ACCESS_TOKEN');
}

/** ตรวจ HMAC-SHA256 signature ของ webhook กัน request ปลอม */
function verifyLineSignature_(rawBody, signatureHeader) {
  var secret = lineProp_('LINE_CHANNEL_SECRET');
  var hash = Utilities.computeHmacSha256Signature(rawBody, secret);
  var computed = Utilities.base64Encode(hash);
  return computed === signatureHeader;
}

function lineApiFetch_(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  options.headers['Authorization'] = 'Bearer ' + lineChannelAccessToken_();
  options.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code >= 300) {
    Logger.log('[lineApiFetch_] ' + url + ' -> ' + code + ' ' + res.getContentText());
    throw new Error('เรียก LINE API ไม่สำเร็จ (HTTP ' + code + ')');
  }
  return res;
}

function lineReply_(replyToken, messages) {
  if (!Array.isArray(messages)) messages = [messages];
  lineApiFetch_('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ replyToken: replyToken, messages: messages })
  });
}

function linePush_(to, messages) {
  if (!Array.isArray(messages)) messages = [messages];
  lineApiFetch_('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ to: to, messages: messages })
  });
}

/** แจ้งเตือนกลุ่มแอดมิน (ต้องตั้ง ADMIN_LINE_GROUP_ID ไว้ล่วงหน้า — เอา group id จาก log ตอนเชิญบอทเข้ากลุ่มแล้วพิมพ์อะไรสักอย่าง) */
function linePushAdminGroup_(text) {
  var groupId = getConfig_('ADMIN_LINE_GROUP_ID');
  if (!groupId) {
    Logger.log('[linePushAdminGroup_] ยังไม่ได้ตั้งค่า ADMIN_LINE_GROUP_ID ข้ามการแจ้งเตือน: ' + text);
    return;
  }
  linePush_(groupId, { type: 'text', text: text });
}

function lineGetProfile_(userId) {
  var res = lineApiFetch_('https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId), { method: 'get' });
  return JSON.parse(res.getContentText());
}

/** ดาวน์โหลดไฟล์สื่อ (รูป/ไฟล์) ที่สมาชิกส่งเข้ามา คืนเป็น Blob */
function lineGetContent_(messageId) {
  var res = lineApiFetch_('https://api-data.line.me/v2/bot/message/' + encodeURIComponent(messageId) + '/content', { method: 'get' });
  return res.getBlob();
}

function lineQuickReply_(items) {
  // items: [{label, text}]
  return {
    items: items.map(function (it) {
      return { type: 'action', action: { type: 'message', label: it.label, text: it.text } };
    })
  };
}
