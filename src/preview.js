'use strict';
// The local counterpart of framebuffer.js: a stage writer that streams frames
// to a browser on this machine, so a scene can be watched moving without a Pi
// and a CRT in the loop.
//
// It packs with the real packer from framebuffer.js rather than sending the
// canvas, so what arrives in the browser is the 16-bit RGB565 the display
// controller would actually be reading -- a PNG shows you 24-bit truth the tube
// never receives. The rest of the CRT's distortions (non-square pixels, the two
// interlaced fields, overscan, chroma bleed) are modelled in preview.html,
// where they can be toggled without restarting the loop.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const framebuffer = require('./framebuffer');

const CLIENT = path.join(__dirname, 'preview.html');

// A frame is 675 KB of RGB565, which is 166 Mbit/s at 30 fps -- fine down a
// loopback socket, hopeless over wifi to a phone. Flat poster colours deflate
// about thirty to one at level 1 and cost half a millisecond, so a client that
// isn't on this machine gets the stream gzipped and reads about 5 Mbit/s
// instead. Level 1 rather than 6 on purpose: 6 is another 2x for five times the
// CPU, and this runs beside the frame loop.
const GZIP_LEVEL = 1;

// Everything that isn't a socket on this machine.
function remote(req) {
  const ip = req.socket.remoteAddress ?? '';
  return !(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
}

// Where a phone on the same wifi can reach this. The hostname first, because
// `jake.local` survives a DHCP lease that a printed address doesn't.
function addresses(port) {
  const host = os.hostname();
  const names = [host.includes('.') ? host : `${host}.local`];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) names.push(net.address);
    }
  }
  return names.map((name) => `http://${name}:${port}/`);
}

// Frame header, little-endian, ahead of width*height*2 bytes of RGB565:
//   0  uint16 width      8  float32 t (seconds)
//   2  uint16 height    12  uint32  reserved
//   4  uint32 frame
const HEADER = 16;

function open({ port = 7480, host = '127.0.0.1', width = 720, height = 480,
                clock = () => 0, snapshot = () => ({}), onControl = () => {},
                onInput = null } = {}) {
  // A framebuffer that doesn't exist: composite on a Pi 4B comes up 16bpp with
  // no padding, and describing it here rather than reading sysfs is what lets
  // the same packing code run on a Mac.
  // 0.0.0.0 is a bind, not somewhere to point a browser.
  const shown = (h) => (h === '0.0.0.0' || h === '::' ? '127.0.0.1' : h);
  const fb = { device: 'preview', path: `http://${shown(host)}:${port}`, width, height, bpp: 16, stride: width * 2 };

  // Made once, like framebuffer.open() does, and for the same reason.
  const buf = Buffer.alloc(fb.stride * fb.height);
  const view = new Uint16Array(buf.buffer, buf.byteOffset, width * height);
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(width, 0);
  header.writeUInt16LE(height, 2);

  let frame = 0;
  const clients = new Set();  // frames
  const ears = new Set();     // audio

  // Drops for a client that isn't keeping up rather than queueing. A preview
  // that lags behind the loop is worse than one that skips: the whole point is
  // to see the timing the Pi would be running. Audio takes the same deal --
  // src/audio/speaker.js drops blocks on the Pi for the same reason.
  function broadcast(to, payload) {
    for (const client of to) {
      if (client.behind) continue;
      client.behind = !client.write(payload);
    }
  }

  // A chunked binary response that stays open. Both streams are this.
  function subscribe(req, res, to, { compress = false } = {}) {
    const gzip = compress && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    });
    // Node holds headers back until the first body write, so a client that
    // connects between frames would sit there looking disconnected -- and a
    // caller that waits for the response before asking for a frame would wait
    // forever. Send them now.
    res.flushHeaders();
    res.socket?.setNoDelay(true); // frames are latency, not throughput

    // Deflating happens on the threadpool, so the frame loop never waits on it,
    // and each frame is flushed rather than left to fill a block: a stream that
    // buffers holds a frame back until the next one arrives, which is a frame
    // of latency bought for nothing. Backpressure is still read off the socket
    // -- the gzip stream drains long before the wifi does.
    const zip = gzip ? zlib.createGzip({ level: GZIP_LEVEL }) : null;
    zip?.pipe(res);
    // A phone that walks out of range is an EPIPE on this stream, and an
    // unhandled one takes the whole console down with it.
    zip?.on('error', () => { to.delete(client); zip.destroy(); });

    const client = {
      res,
      behind: false,
      write: zip
        ? (payload) => {
          zip.write(payload);
          zip.flush(zlib.constants.Z_SYNC_FLUSH);
          return !res.writableNeedDrain;
        }
        : (payload) => res.write(payload),
    };
    res.on('drain', () => { client.behind = false; });
    to.add(client);
    req.on('close', () => { to.delete(client); zip?.destroy(); });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(CLIENT));
    }

    if (url.pathname === '/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(snapshot()));
    }

    // Frames compress; PCM doesn't, so audio goes down the wire as it is.
    // Anything off this machine gets it compressed, `?gzip` asks for it anyway
    // -- a phone coming down a tunnel arrives looking like loopback -- and
    // `?raw` is the way out if a browser turns out to sit on a gzip stream.
    if (url.pathname === '/stream') {
      const compress = !url.searchParams.has('raw') && (url.searchParams.has('gzip') || remote(req));
      return subscribe(req, res, clients, { compress });
    }
    if (url.pathname === '/audio') return subscribe(req, res, ears);

    // Pad changes from the page: the browser's Gamepad API, or a keyboard
    // standing in for it. The page sends edges, not per-frame state, so a held
    // direction costs two requests rather than sixty a second.
    if (url.pathname === '/input' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let applied = 0;
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          for (const change of body.changes ?? []) {
            if (onInput?.(change.pad, change.button, Boolean(change.down))) applied++;
          }
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ applied }));
      });
      return;
    }

    if (url.pathname === '/control' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let reply;
        try {
          reply = onControl(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply ?? snapshot()));
      });
      return;
    }

    res.writeHead(404).end();
  });

  const writer = {
    fb,
    present(canvas) {
      const a = performance.now();
      if (canvas.width === width && canvas.height === height) framebuffer.packRGB565(canvas.px, view);
      else framebuffer.pack(canvas, fb, buf);
      const b = performance.now();

      header.writeUInt32LE(frame, 4);
      header.writeFloatLE(clock(), 8);
      frame++;
      // A fresh buffer per frame, on purpose. res.write() doesn't copy -- it
      // keeps a reference to whatever it couldn't flush -- so handing it the
      // packing buffer would tear the next frame into a slow client's socket.
      // The concat also keeps a header and its payload in one write, which
      // stops a second frame's header slipping between them.
      broadcast(clients, Buffer.concat([header, buf]));

      return { pack: b - a, write: performance.now() - b };
    },
    // The other half of standing in for the Pi: framebuffer.js has a speaker
    // beside it (audio/speaker.js) and so does this. A scene preview simply
    // never calls it.
    sound(block) {
      if (block?.length) broadcast(ears, block);
    },
    // Deliberately does nothing. stage.run() closes its writer when it stops,
    // and the preview outlives any one stage -- switching scenes stops one loop
    // and starts another against this same server. shutdown() is the real one.
    close() {},
  };

  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  return {
    writer,
    fb,
    listening,
    address: () => server.address(),
    // A function, not a string: with port 0 the real port isn't known until
    // the listen callback has run.
    url: () => `http://${shown(host)}:${server.address()?.port ?? port}/`,
    // The same server as somewhere else on the network can see it. Empty
    // unless it was told to listen on more than loopback.
    urls: () => (host === '0.0.0.0' || host === '::' ? addresses(server.address()?.port ?? port) : []),
    listeners: () => ({ frames: clients.size, audio: ears.size }),
    shutdown() {
      for (const client of [...clients, ...ears]) client.res.end();
      clients.clear();
      ears.clear();
      server.close();
      // A browser keeps its connection alive between requests, and close()
      // only stops new ones -- without this the process lingers on Ctrl-C.
      server.closeAllConnections();
    },
  };
}

module.exports = { open, HEADER, addresses };
