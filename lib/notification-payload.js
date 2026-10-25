'use strict';
// APNs limits regular notification payloads to 4096 bytes, including routing data.
module.exports = function notificationPayload(n) {
  const clip=(value,max)=>Array.from(String(value||'')).slice(0,max).join('');
  const payload={aps:{alert:{title:clip(n.title,180)||'Jarvis',body:clip(n.body,1500)||'Open Jarvis to view this update.'},sound:'default'},notificationId:clip(n.id,220),route:clip(n.href,512)};
  while(Buffer.byteLength(JSON.stringify(payload),'utf8')>4096){
    const chars=Array.from(payload.aps.alert.body);
    if(chars.length>32) payload.aps.alert.body=chars.slice(0,-32).join('').replace(/…$/,'')+'…';
    else { payload.route='#/'; payload.notificationId=clip(payload.notificationId,100); payload.aps.alert.title=clip(payload.aps.alert.title,100); }
  }
  return payload;
};
