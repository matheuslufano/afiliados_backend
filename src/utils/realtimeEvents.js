const { EventEmitter } = require('node:events');

const bus = new EventEmitter();
bus.setMaxListeners(0);

function publishRealtimeEvent(type, payload = {}) {
  bus.emit('message', {
    type,
    payload,
    emittedAt: new Date().toISOString()
  });
}

function subscribeRealtimeEvents(listener) {
  bus.on('message', listener);

  return () => {
    bus.off('message', listener);
  };
}

module.exports = {
  publishRealtimeEvent,
  subscribeRealtimeEvents
};
