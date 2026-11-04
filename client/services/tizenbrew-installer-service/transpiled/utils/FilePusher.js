"use strict";

var AdbPacket = require('adbhost/lib/packet.js');
var commands = AdbPacket.commands;
module.exports = function (adb, filePath, data, cb) {
  var shell = adb.createStream('sync:');
  var inverval = setInterval(function () {
    if (shell._remoteId === -1) return;
    clearInterval(inverval);
    var statBuffer = new Buffer(8);
    statBuffer.write('STAT', 0);
    statBuffer.writeUInt32LE(filePath.length, 4);
    adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, statBuffer);
    adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, new Buffer(filePath));
    var sendBuffer = new Buffer(8);
    sendBuffer.writeUInt32LE(0x444E4553, 0);
    sendBuffer.writeUInt32LE(filePath.length + 6, 4);
    adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, sendBuffer);
    adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, new Buffer("".concat(filePath, ",33261")));
    if (data.length > 1420) {
      var chunk = data.slice(0, 1420);
      var buffer = new Buffer(8 + chunk.length);
      buffer.write('DATA');
      buffer.writeUInt32LE(chunk.length, 4);
      chunk.copy(buffer, 8);
      adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, buffer);
      for (var i = 1420; i < data.length; i += 1420) {
        var _chunk = data.slice(i, i + 1420);
        var _buffer = new Buffer(8 + _chunk.length);
        _buffer.write('DATA');
        _buffer.writeUInt32LE(_chunk.length, 4);
        _chunk.copy(_buffer, 8);
        adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, _buffer);
      }
    } else {
      var _buffer2 = new Buffer(8 + data.length);
      _buffer2.write('DATA');
      _buffer2.writeUInt32LE(data.length, 4);
      data.copy(_buffer2, 8);
      adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, _buffer2);
    }
    var doneData = new Buffer(8);
    doneData.write('DONE');
    doneData.writeUInt32LE(0x15f2b865, 4);
    adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, doneData);
    var quitData = new Buffer(8);
    quitData.write('QUIT');
    adb._writePacket(commands.WRTE, shell._localId, shell._remoteId, quitData);
    cb();
  }, 500);
};