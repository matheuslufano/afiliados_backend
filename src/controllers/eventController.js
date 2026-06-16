const {
  subscribeRealtimeEvents
} = require('../utils/realtimeEvents');

function writeEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

class EventController {
  stream(req, res) {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    writeEvent(res, 'connected', {
      ok: true,
      connectedAt: new Date().toISOString()
    });

    const heartbeat = setInterval(() => {
      writeEvent(res, 'heartbeat', {
        at: new Date().toISOString()
      });
    }, 25000);

    const unsubscribe = subscribeRealtimeEvents((message) => {
      writeEvent(res, message.type, message);
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }
}

module.exports = new EventController();
