'use strict';
const unavailable=message=>/weekly limit|usage limit|rate.?limit|quota|too many requests|usage cap|insufficient_quota|overloaded|capacity|\b429\b/i.test(String(message));
module.exports={unavailable,canSwitch:({message,switched,hadActions,requiredReview,engine})=>unavailable(message)&&!switched&&!hadActions&&!requiredReview&&['claude','codex'].includes(engine)};
