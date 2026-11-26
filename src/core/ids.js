function yymm_(date) {
  var y = String(date.getFullYear()).slice(2);
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  return y + m;
}

/** 'PO-2611-008' のような月内連番IDを返す。 */
function nextSerialId(prefix, date, existingIds) {
  var head = prefix + '-' + yymm_(date) + '-';
  var max = 0;
  (existingIds || []).forEach(function (id) {
    var s = String(id);
    if (s.indexOf(head) !== 0) return;
    var n = parseInt(s.slice(head.length, head.length + 3), 10);
    if (n > max) max = n;
  });
  if (max >= 999) throw new Error(head + ' の連番が999を超えます');
  return head + ('00' + (max + 1)).slice(-3);
}

function lineId(orderId, branch) {
  if (branch < 1 || branch > 99) throw new Error('枝番は1〜99: ' + branch);
  return orderId + '-' + ('0' + branch).slice(-2);
}

if (typeof module !== 'undefined') module.exports = { nextSerialId: nextSerialId, lineId: lineId, yymm_: yymm_ };
